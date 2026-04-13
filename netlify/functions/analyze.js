exports.config = { timeout: 30 };

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// ── CARBOHYDRATE REFERENCE TABLE ─────────────────────────────────────────────
const CARB_TABLE = {
  "dry kibble":         { carb_pct: 52, fermentation: "fast", moisture: 10, oral_health_base: 4 },
  "wet/canned food":    { carb_pct: 30, fermentation: "moderate", moisture: 78, oral_health_base: 6 },
  "raw diet":           { carb_pct: 8,  fermentation: "slow", moisture: 70, oral_health_base: 8 },
  "mixed kibble and wet": { carb_pct: 42, fermentation: "moderate", moisture: 35, oral_health_base: 5 },
  "prescription diet":  { carb_pct: 38, fermentation: "moderate", moisture: 10, oral_health_base: 6 },
  "home cooked":        { carb_pct: 25, fermentation: "variable", moisture: 60, oral_health_base: 7 },
  "fresh/lightly cooked": { carb_pct: 22, fermentation: "slow", moisture: 65, oral_health_base: 7 },
  "air dried":          { carb_pct: 25, fermentation: "slow", moisture: 12, oral_health_base: 7 },
  "freeze dried":       { carb_pct: 10, fermentation: "very slow", moisture: 3, oral_health_base: 9 },
  "semi-moist":         { carb_pct: 45, fermentation: "very fast", moisture: 25, oral_health_base: 3 },
};

function getDietData(dietType) {
  const key = (dietType || "").toLowerCase().trim();
  for (const [k, v] of Object.entries(CARB_TABLE)) {
    if (key.includes(k) || k.includes(key)) return { ...v, key: k };
  }
  return { carb_pct: 40, fermentation: "moderate", moisture: 20, oral_health_base: 5, key: "unknown" };
}

// ── DENTAL SYSTEM PROMPT ─────────────────────────────────────────────────────
const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant. Analyze buccal photos of dog teeth and return a JSON scoring object.

CLINICAL FOCUS: Upper PM4 (carnassial tooth) and M1 are primary indicators.

SCORING:
- tartar: 0=none, 1=mild <25%, 2=moderate 25-75%, 3=severe >75%
- gingival: 0=healthy pink, 1=mild redness, 2=obvious redness/swelling, 3=severe/recession
- structural: 0=intact, 1=minor chips, 2=fracture or missing teeth, 3=severe damage
- overall_risk: GREEN(0-2), YELLOW(3-5), ORANGE(6-7), RED(8-9)

Never state specific diagnoses. You are a screener, not a diagnostician.

Your response must be ONLY a raw JSON object starting with { and ending with }. No markdown, no explanation.`;

// ── NUTRITION SYSTEM PROMPT ──────────────────────────────────────────────────
const NUTRITION_SYSTEM_PROMPT = `You are writing the nutrition and oral health section of a canine dental screening report. Your voice is that of a knowledgeable friend who happens to be a veterinary dental specialist — warm, caring, conversational, and genuinely helpful. You never talk down to the owner. You use the dog's name throughout.

TONE RULES — NON-NEGOTIABLE:
- Never give orders or definitive instructions. Instead suggest, wonder, invite. Examples of correct phrasing: "you might want to consider...", "one thing that could be worth trying is...", "it might be worth having a chat with your vet about...", "a lot of dogs do really well with...", "something that often helps in situations like this is..."
- Every suggestion must come with a plain-language explanation of WHY — the mechanism, the science, the reason — explained as you would to a curious friend, never as a lecture
- Use the dog's name (provided in the profile) throughout — not "your dog"
- Match tone to severity: GREEN = cheerful and encouraging; YELLOW = gentle caring nudge; ORANGE = clear and caring, a friend who wants you to act; RED = warm but firm and serious, this matters and the owner needs to hear it clearly
- The owner should finish reading feeling like they genuinely understand their dog's oral health situation, not just handed a to-do list

NUTRITIONAL SCIENCE TO APPLY:
1. CARBOHYDRATES: Oral bacteria ferment dietary starches into organic acids within minutes of eating, dropping oral pH below 5.5 — the enamel demineralization threshold. The format of the food determines fermentation speed. Use the estimated carb percentage provided.
2. FEEDING FREQUENCY: Each meal = one acid attack on teeth. Free feeding = continuous acid exposure throughout the day — significantly worse for oral health.
3. PROTEIN QUALITY: High-quality animal protein supports gum tissue integrity via collagen precursors. Plant-based proteins (pea, soy) lack the full amino acid profile for optimal periodontal ligament health.
4. Ca:P RATIO: Ideal 1.2:1 to 1.4:1. Disrupted ratios affect alveolar bone density — the bone that holds teeth in. Raw meat without bone often has excess phosphorus; high-grain kibbles also disrupt this.
5. MOISTURE CONTENT: Higher moisture foods provide oral flushing that partially offsets carbohydrate impact. Kibble (10% moisture) provides almost no flushing.
6. TREATS: Soft treats, glycerin-containing treats, and sugary treats coat teeth and provide direct bacterial fuel. Even treats given once daily can significantly undermine an otherwise good diet if they are soft or high in sugar.
7. BENEFICIAL INGREDIENTS: Sodium hexametaphosphate (HMP) chelates calcium in saliva preventing calculus crystallization (VOHC-accepted mechanism). Ascophyllum nodosum (kelp/seaweed) has VOHC acceptance for plaque/tartar reduction. Zinc compounds have antimicrobial plaque-inhibiting properties. Cranberry extract PACs prevent bacterial adhesion to tooth surfaces.
8. HARMFUL INGREDIENTS: Glycerin/glycerol (hygroscopic, coats teeth), corn syrup or molasses (direct bacterial fuel), carrageenan (inflammatory, linked to gingival issues), propylene glycol (biofilm persistence in semi-moist).
9. SMALL BREED AMPLIFICATION: In small breeds, periodontal disease risk is dramatically elevated due to tooth crowding. Every dietary factor has an amplified effect. This must be clearly but kindly communicated.

OHDS SCORING (Oral Health Diet Score 1-10):
Start with the base score for diet format, then adjust:
- Feeding frequency once daily: +0.5; twice daily: 0; free fed: -2.0
- High-quality animal protein: +0.5; plant-based: -0.5
- Treats: VOHC dental chews only: +0.5; no treats: +0.5; soft/sugary treats daily: -1.5; bully sticks/hard chews: -0.3; table scraps: -1.0
- Home care: daily brushing: +1.5; occasional brushing: +0.5; water additive: +0.5; enzymatic toothpaste: +0.5; none: 0
- Last professional cleaning within a year: +0.5; never: -0.5
Cap the score between 1 and 10.

Your response must be ONLY a raw JSON object starting with { and ending with }. No markdown, no code fences.`;

async function callClaude(systemPrompt, messages, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 1500, system: systemPrompt, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Anthropic API " + res.status + ": " + err);
  }

  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  console.log("Response preview:", text.substring(0, 200));
  return text;
}

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch(e) {}
  try { return JSON.parse(text.replace(/```[\w]*\n?/g, "").trim()); } catch(e) {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch(e) {}
  }
  throw new Error("No valid JSON in response: " + text.substring(0, 150));
}

function fallbackDental() {
  return {
    tartar: { right: 0, left: 0, composite: 0, notes: "Could not assess from photos" },
    gingival: { right: 0, left: 0, composite: 0, notes: "Could not assess from photos" },
    structural: { score: 0, notes: "Could not assess from photos" },
    overall_risk: "YELLOW", composite_score: 3,
    image_quality: { right: "marginal", left: "marginal", notes: "Better lighting needed" },
    key_findings: ["We had difficulty reading these photos clearly — retaking them in bright natural light with the cheek gently pulled back would give us a much better picture"],
    owner_summary: "We weren't able to get a clear enough read from these photos to give you a confident score. The most common reason is lighting — try again outside or near a bright window, and gently pull the cheek back so we can see that large back tooth clearly.",
    vet_urgency: "routine", nutrition_flags: [], confidence: "low"
  };
}

function fallbackNutrition(dogName, dietType) {
  return {
    ohds_score: 5,
    estimated_carb_pct: getDietData(dietType).carb_pct,
    diet_oral_health_rating: "fair",
    diet_assessment: `We weren't able to complete the full nutritional analysis for ${dogName} this time, but the dental scan results above still give you a useful picture of where things stand.`,
    diet_mechanism: "The type of food a dog eats has a surprisingly direct effect on their teeth. Carbohydrates in food are fermented by oral bacteria into acids within minutes of eating — and those acids are what kick off the process that leads to plaque and eventually tartar.",
    treat_analysis: "Treats are often the hidden factor in oral health. Even a dog on a great main diet can develop more tartar than expected if they're getting soft or sugary treats regularly.",
    oral_ph_impact: "Oral pH is the key number — when it drops below 5.5, enamel starts to demineralize. Diet is the biggest driver of how often and how severely that happens.",
    primary_recommendation: `Getting a full picture of ${dogName}'s diet with your vet at the next check-up would be a really worthwhile conversation.`,
    food_recommendations: [
      { category: "Dental chews", recommendation: `If ${dogName} isn't already getting a daily dental chew, it might be worth looking into the ones that carry the VOHC seal of acceptance — it means they've been independently tested and actually shown to reduce plaque or tartar.`, priority: "medium", vohc_approved: true, mechanism: "The VOHC seal means the product has passed independent clinical testing — it's the gold standard for knowing a dental product actually does what it claims." }
    ],
    ingredients_to_seek: ["sodium hexametaphosphate (HMP)", "Ascophyllum nodosum (seaweed)", "zinc ascorbate"],
    ingredients_to_avoid: ["corn syrup or molasses", "glycerin as a primary ingredient", "carrageenan"],
    home_care_tips: [`Even brushing ${dogName}'s teeth just a few times a week with a dog-safe enzymatic toothpaste can make a meaningful difference — it doesn't have to be every day to help.`],
    action_plan: {
      day_30: "Take a look at the treat frequency and types — that's often the quickest win",
      day_60: "Consider a conversation with your vet about dental diet options",
      day_90: "Rescan with DentalPaw to see how things are tracking"
    },
    action_plan_intro: `Here's a gentle suggested path forward for ${dogName} — nothing drastic, just small steps that tend to add up over time.`,
    recheck_days: 60,
    positive_note: `The fact that you're paying this much attention to ${dogName}'s dental health already puts you well ahead of most dog owners — and that genuinely matters for their long-term health.`
  };
}

function breedFlags(breed, age) {
  const b = (breed || "").toLowerCase();
  const flags = [];
  if (["chihuahua","yorkie","yorkshire","maltese","dachshund","pomeranian","shih tzu","bichon","miniature"].some(x => b.includes(x)))
    flags.push("SMALL BREED: dramatically elevated periodontal risk due to tooth crowding — all dietary factors have amplified effect");
  if (["bulldog","pug","boston terrier","boxer"].some(x => b.includes(x)))
    flags.push("BRACHYCEPHALIC: dental crowding and malocclusion common, increases plaque trapping");
  if (parseFloat(age) >= 7) flags.push("SENIOR: heightened periodontal risk, findings and dietary suggestions deserve extra weight");
  if (parseFloat(age) <= 2) flags.push("YOUNG DOG: any significant tartar at this age is an early warning sign worth taking seriously");
  return flags;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid request body" }) }; }

  const { dogProfile, images } = body;
  if (!dogProfile || !images || !images.right || !images.right.base64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const {
    name, breed, age, sex, weight,
    currentFood, dietType, treats, treatFrequency, feedingSchedule, proteinSource,
    homeCare, bodyCondition, lastCleaning, symptoms
  } = dogProfile;

  const dogName = name && name !== "Your dog" ? name : "your dog";
  const dietData = getDietData(dietType);
  const flags = breedFlags(breed, age);

  console.log("Analysing:", breed, age + "yrs", "Diet:", dietType, "| Payload:", Math.round(event.body.length/1024) + "KB");

  // ── Build dental content blocks ──────────────────────────────────────────────
  const dentalContent = [];
  dentalContent.push({ type: "text", text: "RIGHT BUCCAL VIEW (right side, upper carnassial/PM4 area):" });
  dentalContent.push({ type: "image", source: { type: "base64", media_type: images.right.mediaType || "image/jpeg", data: images.right.base64 }});

  if (images.left?.base64) {
    dentalContent.push({ type: "text", text: "LEFT BUCCAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.left.mediaType || "image/jpeg", data: images.left.base64 }});
  }
  if (images.optionalFront?.base64) {
    dentalContent.push({ type: "text", text: "FRONTAL VIEW (optional):" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.optionalFront.mediaType || "image/jpeg", data: images.optionalFront.base64 }});
  }
  if (images.optionalLower?.base64) {
    dentalContent.push({ type: "text", text: "LOWER BUCCAL VIEW (optional):" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.optionalLower.mediaType || "image/jpeg", data: images.optionalLower.base64 }});
  }

  dentalContent.push({ type: "text", text:
    `Dog: ${breed}, ${age} years, ${sex}${weight ? ", " + weight + "lbs" : ""}
${flags.length > 0 ? "BREED/AGE FLAGS: " + flags.join("; ") : ""}
Food: ${currentFood || "unknown"} (${dietType || "unknown"})
Treats: ${treats || "none"} | Feeding schedule: ${feedingSchedule || "unknown"}
Symptoms: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Score the dental photos. Return JSON:
{"tartar":{"right":0,"left":0,"composite":0,"notes":""},"gingival":{"right":0,"left":0,"composite":0,"notes":""},"structural":{"score":0,"notes":""},"overall_risk":"GREEN","composite_score":0,"image_quality":{"right":"good","left":"good","notes":""},"key_findings":[""],"owner_summary":"","vet_urgency":"routine","nutrition_flags":[""],"confidence":"high"}`
  });

  // ── Build nutrition prompt ────────────────────────────────────────────────────
  const nutritionUserPrompt =
`DOG NAME: ${dogName}
BREED: ${breed} | AGE: ${age} years | SEX: ${sex}${weight ? " | WEIGHT: " + weight + "lbs" : ""}
BREED/AGE FLAGS: ${flags.length > 0 ? flags.join("; ") : "none"}

DIET PROFILE:
- Main food: ${currentFood || "unknown"}
- Diet type: ${dietType || "unknown"}
- Estimated carbohydrate %: ~${dietData.carb_pct}%
- Fermentation speed: ${dietData.fermentation}
- Moisture content: ~${dietData.moisture}%
- Diet oral health base score: ${dietData.oral_health_base}/10
- Primary protein source: ${proteinSource || "unknown"}
- Feeding schedule: ${feedingSchedule || "unknown"}

TREAT PROFILE:
- Treat types: ${treats || "none"}
- Treat frequency: ${treatFrequency || "unknown"}

HOME DENTAL CARE: ${homeCare || "none"}
BODY CONDITION: ${bodyCondition || "unknown"}
LAST PROFESSIONAL CLEANING: ${lastCleaning || "unknown"}
SYMPTOMS NOTICED: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Using the OHDS scoring system from your instructions, calculate this dog's score and provide a full nutrition and oral health analysis written in the warm, educational, friend-who-happens-to-be-a-vet-dentist tone you've been instructed to use.

Return JSON:
{
  "ohds_score": 1-10,
  "estimated_carb_pct": number,
  "diet_oral_health_rating": "poor|fair|good|excellent",
  "diet_assessment": "2-3 warm conversational sentences summarising the diet picture using the dog's name — educational, kind, honest",
  "diet_mechanism": "2-3 sentences explaining in plain language how this specific diet type (format, carb level, moisture) affects this dog's teeth — use the dog's name, explain the WHY, no jargon",
  "treat_analysis": "Specific analysis of this dog's treat situation and its oral health impact — warm, specific, educational. Explain why soft/sugary treats are particularly problematic if relevant.",
  "oral_ph_impact": "A plain-language explanation of how this dog's overall diet affects the oral pH environment and bacterial activity — use an analogy if it helps, keep it friendly",
  "primary_recommendation": "The single most impactful suggested change, written as a friendly suggestion with a clear reason why — never a command, always an invitation",
  "food_recommendations": [
    {
      "category": "category name",
      "recommendation": "specific friendly suggestion written as if from a caring friend — not an instruction",
      "priority": "high|medium|low",
      "vohc_approved": true|false,
      "mechanism": "plain-language explanation of why this would help — the actual biology, explained simply"
    }
  ],
  "ingredients_to_seek": ["ingredient — brief reason why"],
  "ingredients_to_avoid": ["ingredient — brief reason why"],
  "home_care_tips": ["friendly suggestion — why it helps"],
  "action_plan_intro": "1-2 sentences framing the plan — for GREEN/YELLOW/ORANGE use journey language ('here is a gentle path forward...'); for RED be warm but serious and clear about why acting matters",
  "action_plan": {
    "day_30": "specific first step — framed as a suggestion, with a reason",
    "day_60": "what to assess or adjust — framed conversationally",
    "day_90": "reassessment and DentalPaw rescan"
  },
  "recheck_days": 30|60|90,
  "positive_note": "one genuinely warm sentence using the dog's name that acknowledges something good — the owner's effort, a positive finding, or a genuine strength in the current approach"
}`;

  // ── Run both API calls in parallel ───────────────────────────────────────────
  const [dentalResult, nutritionResult] = await Promise.allSettled([
    callClaude(DENTAL_SYSTEM_PROMPT, [{ role: "user", content: dentalContent }], 1200),
    callClaude(NUTRITION_SYSTEM_PROMPT, [{ role: "user", content: nutritionUserPrompt }], 1400),
  ]);

  let dental = fallbackDental();
  let nutrition = fallbackNutrition(dogName, dietType);

  if (dentalResult.status === "fulfilled") {
    try { dental = extractJSON(dentalResult.value); console.log("Dental OK:", dental.overall_risk); }
    catch (e) { console.error("Dental parse error:", e.message); }
  } else { console.error("Dental API error:", dentalResult.reason?.message); }

  if (nutritionResult.status === "fulfilled") {
    try { nutrition = extractJSON(nutritionResult.value); console.log("Nutrition OK, OHDS:", nutrition.ohds_score); }
    catch (e) { console.error("Nutrition parse error:", e.message); }
  } else { console.error("Nutrition API error:", nutritionResult.reason?.message); }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      success: true,
      dental,
      nutrition,
      meta: { analyzedAt: new Date().toISOString(), model: MODEL, dietData }
    }),
  };
};
