const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── DENTAL ANALYSIS SYSTEM PROMPT ───────────────────────────────────────────
const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant embedded in a consumer wellness app. You analyze buccal (cheek-side) photos of dog teeth to provide a standardized screening score. You are NOT a diagnostic tool — you are a wellness screener.

CLINICAL FOCUS: The upper fourth premolar (PM4, carnassial tooth) and first upper molar (M1) are your primary indicators. These teeth show tartar accumulation and gingivitis earliest and most severely in dogs.

SCORING RUBRIC:

TARTAR SCORE (0-3):
0 = None: Clean tooth surface, natural white/cream enamel visible, no deposits
1 = Mild: Light yellow/cream deposits near gumline, <25% surface coverage
2 = Moderate: Yellow-brown deposits, 25-75% surface, gumline partially obscured  
3 = Severe: Dark brown/black heavy calculus, >75% coverage, crown may be obscured

GINGIVAL SCORE (0-3):
0 = Healthy: Pale pink, firm, tight margin against tooth
1 = Mild: Light redness along gum margin, slight swelling
2 = Moderate: Obvious redness and swelling, irregular margin
3 = Severe: Bright red/purple, recession visible, possible bleeding areas

STRUCTURAL SCORE (0-3):
0 = Intact: All visible teeth complete, no chips or discoloration
1 = Minor: Small chips on incisors, slight discoloration on 1-2 teeth
2 = Moderate: Slab fracture visible OR multiple discolored/missing teeth
3 = Severe: Multiple fractures, possible pulp exposure, severe wear

OVERALL RISK CALCULATION:
- GREEN (0-2 composite): Healthy, maintain routine
- YELLOW (3-5 composite): Monitor, improve home care
- ORANGE (6-7 composite): Vet exam recommended within 1-2 months
- RED (8-9 composite): Prompt veterinary attention needed

IMAGE QUALITY ASSESSMENT:
- good: PM4/M1 clearly visible, gumline in frame, adequate lighting
- marginal: Partially obscured but scoreable
- poor: Cannot reliably score (blurry, wrong angle, too dark)

IMPORTANT CONSTRAINTS:
- Never state specific diagnoses like "Stage 2 Periodontal Disease"
- Always recommend professional vet evaluation for any non-zero gingival score
- You cannot assess subgingival disease or periodontal pocket depth
- If image quality is poor, say so honestly rather than guessing
- Be warm and encouraging — the owner is trying to help their dog

RESPOND ONLY WITH VALID JSON matching this exact schema:
{
  "tartar": {
    "right": 0,
    "left": 0,
    "composite": 0,
    "notes": "brief observation"
  },
  "gingival": {
    "right": 0,
    "left": 0,
    "composite": 0,
    "notes": "brief observation"
  },
  "structural": {
    "score": 0,
    "notes": "brief observation"
  },
  "overall_risk": "GREEN",
  "composite_score": 0,
  "image_quality": {
    "right": "good",
    "left": "good",
    "notes": "brief quality observation"
  },
  "key_findings": ["finding 1", "finding 2"],
  "owner_summary": "2-3 warm, plain-language sentences summarizing what you found",
  "vet_urgency": "routine",
  "nutrition_flags": ["flag1", "flag2"],
  "confidence": "high"
}`;

// ─── NUTRITION SYSTEM PROMPT ──────────────────────────────────────────────────
const NUTRITION_SYSTEM_PROMPT = `You are a canine nutrition advisor specializing in oral health. Based on dental screening results and a dog's profile, provide specific, evidence-based dietary recommendations.

RULES:
- Only recommend products/approaches with VOHC (Veterinary Oral Health Council) acceptance or strong clinical evidence
- Be specific and actionable — not generic advice
- Account for breed size, age, and current diet in your recommendations
- Frame positively: reinforce good habits, suggest improvements gently
- Connect dental findings directly to dietary causes where evident
- Small breeds need specific guidance (higher perio risk, crowding)
- Never recommend supplements without noting vet oversight is advisable
- Keep tone warm and motivating — owner is engaged and trying to help

RESPOND ONLY WITH VALID JSON:
{
  "diet_assessment": "1-2 sentences on how their current diet likely affects their dog's dental health",
  "primary_recommendation": "The single most impactful change they can make right now",
  "food_recommendations": [
    {
      "category": "kibble|wet|chew|supplement|routine",
      "recommendation": "specific actionable advice",
      "priority": "high|medium|low",
      "vohc_approved": true
    }
  ],
  "ingredients_to_seek": ["ingredient or food type 1", "ingredient 2"],
  "ingredients_to_avoid": ["ingredient 1", "ingredient 2"],
  "home_care_tips": ["specific tip 1", "specific tip 2"],
  "recheck_days": 60,
  "positive_note": "One encouraging sentence about something they're doing right or the dog's specific strengths"
}`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function buildBreedContext(breed, age, sex, weight) {
  const smallBreeds = ["chihuahua","yorkshire terrier","yorkie","maltese","dachshund","toy poodle","miniature poodle","pomeranian","shih tzu","papillon","miniature schnauzer","cavalier king charles","bichon frise","miniature dachshund"];
  const brachyBreeds = ["english bulldog","french bulldog","pug","boston terrier","boxer","shih tzu","cavalier king charles","brussels griffon","pekinese","lhasa apso"];
  
  const breedLower = breed.toLowerCase();
  const isSmall = smallBreeds.some(b => breedLower.includes(b));
  const isBrachy = brachyBreeds.some(b => breedLower.includes(b));

  let context = `Breed: ${breed} | Age: ${age} years | Sex: ${sex}`;
  if (weight) context += ` | Weight: ${weight} lbs`;
  if (isSmall) context += ` | BREED RISK FLAG: Small breed — elevated periodontal disease risk due to tooth crowding`;
  if (isBrachy) context += ` | BREED RISK FLAG: Brachycephalic breed — dental crowding and malocclusion common`;
  if (age >= 7) context += ` | AGE FLAG: Senior dog — heightened periodontal risk, findings should be taken seriously`;
  if (age <= 2) context += ` | AGE FLAG: Young dog — any significant tartar at this age is an early warning sign`;

  return context;
}

function parseJSON(text) {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { dogProfile, images } = body;

  // Validate required fields
  if (!dogProfile || !images || !images.rightUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required fields: dogProfile and images.rightUrl" }),
    };
  }

  try {
    // ── STEP 1: Build image content blocks ──────────────────────────────────
    const imageBlocks = [];

    imageBlocks.push({ type: "text", text: "Image 1 — RIGHT BUCCAL VIEW (right side of dog's mouth, upper premolars and carnassial tooth visible):" });
    imageBlocks.push({ type: "image", source: { type: "url", url: images.rightUrl } });

    if (images.leftUrl) {
      imageBlocks.push({ type: "text", text: "Image 2 — LEFT BUCCAL VIEW (left side of dog's mouth, upper premolars and carnassial tooth visible):" });
      imageBlocks.push({ type: "image", source: { type: "url", url: images.leftUrl } });
    } else {
      imageBlocks.push({ type: "text", text: "Note: Only right buccal view provided. Score left side as 'not assessed'." });
    }

    // Optional additional photos
    if (images.optionalFrontUrl) {
      imageBlocks.push({ type: "text", text: "OPTIONAL Image 3 — FRONTAL VIEW (incisors and canine teeth):" });
      imageBlocks.push({ type: "image", source: { type: "url", url: images.optionalFrontUrl } });
    }

    if (images.optionalLowerUrl) {
      imageBlocks.push({ type: "text", text: "OPTIONAL Image 4 — LOWER BUCCAL VIEW (lower jaw teeth):" });
      imageBlocks.push({ type: "image", source: { type: "url", url: images.optionalLowerUrl } });
    }

    // ── STEP 2: Build context prompt ────────────────────────────────────────
    const { breed, age, sex, weight, currentFood, dietType, treats, homeCare, bodyCondition, lastCleaning, symptoms } = dogProfile;

    const breedContext = buildBreedContext(breed, age, sex, weight);

    const contextPrompt = `
DOG PROFILE:
${breedContext}
Current Diet: ${currentFood || "Not specified"} (${dietType || "unknown type"})
Treats: ${treats || "Not specified"}
Home Dental Care: ${homeCare || "None reported"}
Body Condition: ${bodyCondition || "Not reported"}
Last Professional Cleaning: ${lastCleaning || "Unknown"}
Owner-Reported Symptoms: ${symptoms && symptoms.length > 0 ? symptoms.join(", ") : "None"}

Please analyze the provided buccal photo(s) and return the JSON scoring object. Focus primarily on the upper PM4 (carnassial) and M1 on each side as your primary indicators.`.trim();

    // ── STEP 3: Call Claude for dental analysis ──────────────────────────────
    const dentalResponse = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: DENTAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: contextPrompt }] }],
    });

    const dentalText = dentalResponse.content.filter(b => b.type === "text").map(b => b.text).join("");
    const dentalResult = parseJSON(dentalText);

    // ── STEP 4: Call Claude for nutrition recommendations ────────────────────
    const nutritionPrompt = `
Dental Screening Results:
${JSON.stringify(dentalResult, null, 2)}

Dog Profile:
- Breed: ${breed}, Age: ${age} years, Sex: ${sex}
- Current Food: ${currentFood} (${dietType})
- Treats: ${treats || "None specified"}
- Home Dental Care: ${homeCare || "None"}
- Body Condition: ${bodyCondition || "Not reported"}
- Symptoms Noted: ${symptoms && symptoms.length > 0 ? symptoms.join(", ") : "None"}

Please provide specific nutrition and oral health recommendations based on these findings.`.trim();

    const nutritionResponse = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: NUTRITION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: nutritionPrompt }],
    });

    const nutritionText = nutritionResponse.content.filter(b => b.type === "text").map(b => b.text).join("");
    const nutritionResult = parseJSON(nutritionText);

    // ── STEP 5: Return combined result ───────────────────────────────────────
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        dental: dentalResult,
        nutrition: nutritionResult,
        meta: {
          analyzedAt: new Date().toISOString(),
          imagesAnalyzed: Object.values(images).filter(Boolean).length,
          model: "claude-sonnet-4-6",
        },
      }),
    };
  } catch (error) {
    console.error("Analysis error:", error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: false,
        error: "Analysis failed. Please try again.",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      }),
    };
  }
};
