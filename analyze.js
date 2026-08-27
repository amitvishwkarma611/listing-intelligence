import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";

const schema = {
  type:"object",
  properties:{
    productUnderstanding:{type:"object",properties:{
      productType:{type:"string"},category:{type:"string"},primaryIntent:{type:"string"},
      material:{type:"string"},usage:{type:"string"}
    },required:["productType","category","primaryIntent","material","usage"]},
    keywordAnalysis:{type:"object",properties:{
      keywordRanking:{type:"array",items:{type:"object",properties:{
        keyword:{type:"string"},relevanceScore:{type:"integer"},intent:{type:"string"},
        placement:{type:"array",items:{type:"string"}},reason:{type:"string"}
      },required:["keyword","relevanceScore","intent","placement","reason"]}},
      primary:{type:"array",items:{type:"object",properties:{keyword:{type:"string"},reason:{type:"string"}},required:["keyword","reason"]}},
      secondary:{type:"array",items:{type:"object",properties:{keyword:{type:"string"},reason:{type:"string"}},required:["keyword","reason"]}},
      longTail:{type:"array",items:{type:"object",properties:{keyword:{type:"string"},reason:{type:"string"}},required:["keyword","reason"]}},
      conditional:{type:"array",items:{type:"object",properties:{keyword:{type:"string"},reason:{type:"string"}},required:["keyword","reason"]}},
      rejected:{type:"array",items:{type:"object",properties:{keyword:{type:"string"},reason:{type:"string"}},required:["keyword","reason"]}}
    },required:["primary","secondary","longTail","conditional","rejected","keywordRanking"]},
    title:{type:"string"},description:{type:"string"},
    attributes:{type:"object",additionalProperties:{type:"string"}},
    signalScore:{type:"integer"},
    scoreBreakdown:{type:"object",properties:{
      productAccuracy:{type:"integer"},searchRelevance:{type:"integer"},keywordRelevance:{type:"integer"},
      attributeCompleteness:{type:"integer"},naturalLanguage:{type:"integer"},dataConsistency:{type:"integer"},
      keywordStuffingRisk:{type:"string",enum:["LOW","MEDIUM","HIGH"]},
      issues:{type:"array",items:{type:"string"}}
    },required:["productAccuracy","searchRelevance","keywordRelevance","attributeCompleteness","naturalLanguage","dataConsistency","keywordStuffingRisk","issues"]},
    issues:{type:"array",items:{type:"string"}},
    claimGuard:{type:"object",properties:{
      status:{type:"string",enum:["PASS","REVIEW"]},
      detectedClaims:{type:"array",items:{type:"string"}},
      unsupportedClaims:{type:"array",items:{type:"string"}}
    },required:["status","detectedClaims","unsupportedClaims"]},
    performanceFeedback:{type:"object",properties:{
      summary:{type:"string"},recommendation:{type:"string"},metrics:{type:"object",additionalProperties:{type:"number"}},
      diagnosis:{type:"array",items:{type:"string"}}
    },required:["summary","recommendation","metrics","diagnosis"]},
    querySimulation:{type:"array",items:{type:"object",properties:{
      query:{type:"string"},matchScore:{type:"integer"},matchedSignals:{type:"array",items:{type:"string"}},
      missingSignals:{type:"array",items:{type:"string"}},recommendation:{type:"string"}
    },required:["query","matchScore","matchedSignals","missingSignals","recommendation"]}}
  },
  required:["productUnderstanding","keywordAnalysis","title","description","attributes","signalScore","scoreBreakdown","issues","claimGuard","performanceFeedback","querySimulation"]
};

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const words = s => norm(s).split(" ").filter(Boolean);
const uniq = a => [...new Set(a)];
const containsPhrase = (text, phrase) => norm(text).includes(norm(phrase));
const suppliedKeywords = payload => Array.isArray(payload.suggestedKeywords) ? payload.suggestedKeywords.map(x=>String(x).trim()).filter(Boolean) : [];

function buildPrompt(marketplace, style, verified, keywords){
return `You are a marketplace listing intelligence engine for ${marketplace}.
Style: ${style}.

GOAL:
Convert product images + seller-verified facts + marketplace-suggested keywords into an accurate,
natural, search-relevant and conversion-friendly listing.

SOURCE PRIORITY:
1. Seller-verified facts are authoritative.
2. Images support visible observations only; they do not prove hidden specifications.
3. Marketplace-suggested keywords are evidence of search demand, not permission to stuff.

NEVER invent dimensions, weight, pack quantity, material grades, certifications, medical claims,
antibacterial/waterproof/durable claims, search volume, rankings, or unsupported benefits.
If a fact is missing, use "Not provided" or mark related keyword CONDITIONAL.

KEYWORD POLICY:
For every supplied keyword, first score it from 0-100 using:
- direct product match: 0-30
- search intent match: 0-25
- category/product-type match: 0-20
- verified attribute match: 0-15
- natural usability: 0-10
Do NOT use raw search volume as the relevance score.
Classify every supplied keyword exactly once as PRIMARY, SECONDARY, LONG_TAIL, CONDITIONAL, or REJECTED.
Use only genuinely relevant terms. Do not create fake search-volume data.
Natural long-tail variants are allowed only when directly supported by the product and intent.
Avoid repeating a phrase unnaturally.

TITLE:
Product-first, natural, readable, concise enough for marketplace use.

DESCRIPTION:
Natural buyer-facing listing. Use verified facts. No SEO article and no keyword stuffing.

ATTRIBUTES:
Only verified/supported values. Do not guess.

Return only JSON matching the provided schema.

SELLER VERIFIED DATA:
${JSON.stringify(verified,null,2)}

SUPPLIED MARKETPLACE KEYWORDS:
${JSON.stringify(keywords,null,2)}`;
}

function parseDataUrl(x){
 const m=String(x||"").match(/^data:([^;]+);base64,(.+)$/s);
 if(!m) throw new Error("Invalid image data");
 return {mime_type:m[1],data:m[2]};
}

function validateAndRepair(result,payload){
 const verified=payload.product?.verified||{};
 const keywords=suppliedKeywords(payload);
 const allGroups=["primary","secondary","longTail","conditional","rejected"];
 const seen=new Set();
 const issues=[];
 const ka=result.keywordAnalysis||{};
 const ranking=Array.isArray(ka.keywordRanking)?ka.keywordRanking:[];
 const suppliedKeywordsNorm=new Map(keywords.map(k=>[norm(k),k]));
 // Normalize model ranking to supplied keyword universe and clamp scores.
 ka.keywordRanking=ranking.filter(x=>x&&typeof x.keyword==="string")
   .map(x=>({
      keyword: suppliedKeywordsNorm.get(norm(x.keyword)) || x.keyword.trim(),
      relevanceScore: Math.max(0,Math.min(100,Number(x.relevanceScore)||0)),
      intent:String(x.intent||"unknown"),
      placement:Array.isArray(x.placement)?x.placement.filter(Boolean).slice(0,3):[],
      reason:String(x.reason||"")
   }))
   .filter(x=>suppliedKeywordsNorm.has(norm(x.keyword)));

 for(const g of allGroups){
   if(!Array.isArray(ka[g])) ka[g]=[];
 }
 // A supplied keyword must appear in exactly one group.
 for(const g of allGroups){
   ka[g]=ka[g].filter(x=>x&&typeof x.keyword==="string").map(x=>({keyword:x.keyword.trim(),reason:String(x.reason||"")}))
     .filter(x=>x.keyword);
   ka[g]=ka[g].filter(x=>{const n=norm(x.keyword);if(seen.has(n)){issues.push(`Duplicate keyword classification removed: ${x.keyword}`);return false}seen.add(n);return true});
 }
 const suppliedSet=new Set(keywords.map(norm));
 const classified=new Set(allGroups.flatMap(g=>ka[g].map(x=>norm(x.keyword))));
 const missing=keywords.filter(k=>!classified.has(norm(k)));
 if(missing.length){issues.push(`${missing.length} supplied keyword(s) were not classified by the model; moved to REJECTED for safety.`);ka.rejected.push(...missing.map(k=>({keyword:k,reason:"Model did not classify this supplied keyword; excluded by validation."})))}
 // Verify attributes against seller data. Model can omit or normalize, but cannot contradict a provided fact.
 const attrs={...(result.attributes||{})};
 const mappings={material:"material",color:"color",pack:"pack quantity",size:"size / dimensions",usage:"usage",type:"product type"};
 for(const [field,label] of Object.entries(mappings)){
   const supplied=String(verified[field]||"").trim();
   if(!supplied) continue;
   const match=Object.entries(attrs).find(([k])=>norm(k).includes(norm(label))||norm(label).includes(norm(k)));
   if(match && norm(match[1])!==norm(supplied) && !norm(match[1]).includes(norm(supplied)) && !norm(supplied).includes(norm(match[1]))){
     issues.push(`Attribute "${label}" contradicted seller data and was replaced with the verified value.`);
     attrs[match[0]]=supplied;
   } else if(!match){
     attrs[label]=supplied;
   }
 }
 // Remove unsupported empty/guess-like values.
 for(const [k,v] of Object.entries(attrs)){
   if(!String(v).trim()) delete attrs[k];
 }
 // Basic title/description stuffing guard.
 const text=norm((result.title||"")+" "+(result.description||""));
 const counts={};
 for(const k of keywords){const n=norm(k);if(n.length>3) counts[n]=(text.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"))||[]).length}
 const repeated=Object.entries(counts).filter(([,c])=>c>=4);
 if(repeated.length) issues.push("Keyword stuffing risk detected: some supplied phrases repeat too often.");
 // Ensure seller verified material doesn't disappear from title/description/attributes all at once.
 const verifiedImportant=[verified.material,verified.type,verified.usage].filter(Boolean);
 for(const v of verifiedImportant){
   if(!containsPhrase(text,v) && !Object.values(attrs).some(a=>containsPhrase(a,v))){
     issues.push(`Verified detail "${v}" is missing from the final listing/attributes.`);
   }
 }
 // Conservative score cap if validation found issues.
 let score=Math.max(0,Math.min(100,Number(result.signalScore)||0));
 if(issues.length) score=Math.min(score,96);
 if(repeated.length) score=Math.min(score,82);
 result.signalScore=score;
 result.attributes=attrs;
 const perf=payload.performance||{};
 const imp=Number(perf.impressions)||0, clk=Number(perf.clicks)||0, ord=Number(perf.orders)||0, ret=Number(perf.returns)||0;
 if(imp>0||clk>0||ord>0||ret>0){
   const ctr=imp>0?+(clk/imp*100).toFixed(2):0;
   const cvr=clk>0?+(ord/clk*100).toFixed(2):0;
   const rr=ord>0?+(ret/ord*100).toFixed(2):0;
   result.performanceFeedback=result.performanceFeedback||{};
   result.performanceFeedback.metrics={impressions:imp,clicks:clk,orders:ord,returns:ret,ctr,cvr,returnRate:rr};
   const diag=Array.isArray(result.performanceFeedback.diagnosis)?result.performanceFeedback.diagnosis:[];
   if(imp>0&&clk===0) diag.push("No clicks were recorded in the supplied data; review thumbnail, title, price and offer together.");
   if(imp>0&&ctr<1) diag.push("CTR is low in the supplied sample; investigate the first impression factors before changing keywords alone.");
   if(clk>0&&cvr<2) diag.push("Conversion rate is low in the supplied sample; check product-page trust, price, reviews, delivery and expectation match.");
   if(ord>0&&rr>10) diag.push("Return rate is elevated in the supplied sample; check whether listing promises match the delivered product.");
   result.performanceFeedback.diagnosis=uniq(diag);
   result.performanceFeedback.summary=result.performanceFeedback.summary||`Supplied sample: ${imp} impressions, ${clk} clicks, ${ord} orders, ${ret} returns.`;
   result.performanceFeedback.recommendation=result.performanceFeedback.recommendation||"Use these metrics as directional feedback and change one major listing variable at a time.";
 }else{
   result.performanceFeedback={summary:"No performance data supplied.",recommendation:"Add real marketplace metrics after the listing has enough traffic for a useful sample.",metrics:{impressions:0,clicks:0,orders:0,returns:0,ctr:0,cvr:0,returnRate:0},diagnosis:[]};
 }

 result.keywordAnalysis=ka;
 const qs=Array.isArray(result.querySimulation)?result.querySimulation:[];
 result.querySimulation=qs.filter(x=>x&&typeof x.query==="string").map(x=>({
   query:x.query.trim(),
   matchScore:Math.max(0,Math.min(100,Number(x.matchScore)||0)),
   matchedSignals:Array.isArray(x.matchedSignals)?x.matchedSignals.map(String).slice(0,8):[],
   missingSignals:Array.isArray(x.missingSignals)?x.missingSignals.map(String).slice(0,8):[],
   recommendation:String(x.recommendation||"")
 })).filter(x=>x.query);

 result.issues=uniq([...(Array.isArray(result.issues)?result.issues:[]),...issues]);
 result.scoreBreakdown=result.scoreBreakdown||{};
 result.scoreBreakdown.issues=result.issues;
 result.scoreBreakdown.validationIssues=issues.length;
 result.scoreBreakdown.validationStatus=issues.length?"REVIEW":"PASS";
 return result;
}

export default async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
 try{
  if(!process.env.GEMINI_API_KEY) return res.status(500).json({error:"GEMINI_API_KEY is not configured on the server."});
  const payload=req.body||{};
  if(!payload.product?.name) return res.status(400).json({error:"Product name is required."});
  const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
  const verified=payload.product.verified||{};
  const keywords=suppliedKeywords(payload);
  const images=Array.isArray(payload.images)?payload.images.slice(0,8):[];
  const perf=payload.performance||{};
    const perfText=`\n\nACTUAL PERFORMANCE DATA (optional):\n${JSON.stringify(perf,null,2)}`;
    const input=[
    {type:"text",text:buildPrompt(payload.marketplace||"Meesho",payload.style||"Natural & clear",verified,keywords)+perfText+`\n\nPRODUCT NAME:\n${payload.product.name}`},
    ...images.map(x=>({type:"image",...parseDataUrl(x.data)}))
  ];
  const interaction=await ai.interactions.create({
    model:MODEL,input,
    response_format:{type:"text",mime_type:"application/json",schema}
  });
  if(!interaction.output_text) throw new Error("Gemini returned no structured output.");
  const result=JSON.parse(interaction.output_text);
  const finalResult=validateAndRepair(result,payload);
 const verifiedText=JSON.stringify(payload.product?.verified||{}).toLowerCase();
 const finalText=(String(finalResult.title||"")+" "+String(finalResult.description||"")+" "+JSON.stringify(finalResult.attributes||"")).toLowerCase();
 const risky=["100%","food grade","food-grade","antibacterial","waterproof","water proof","medical grade","dermatologically tested","lifetime","chemical free"];
 const detected=risky.filter(x=>finalText.includes(x));
 const unsupported=detected.filter(x=>!verifiedText.includes(x));
 finalResult.claimGuard={
   status:unsupported.length?"REVIEW":"PASS",
   detectedClaims:detected,
   unsupportedClaims:unsupported
 };
 if(unsupported.length){
   finalResult.issues=Array.from(new Set([...(finalResult.issues||[]),"Claim Guard found unsupported claim wording: "+unsupported.join(", ")+". Verify before publishing."]));
   finalResult.signalScore=Math.min(Number(finalResult.signalScore)||0,80);
 }
 return res.status(200).json(finalResult);
 }catch(err){
  console.error(err);
  return res.status(500).json({error:err?.message||"AI analysis failed."});
 }
}
