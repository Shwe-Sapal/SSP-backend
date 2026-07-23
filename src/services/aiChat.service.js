import * as aiSaleReport from "./aiSaleReport.service.js";
import NodeCache from "node-cache";

const aiCache = new NodeCache({
  stdTTL: 1800,
  maxKeys: 50,
  checkperiod: 60,
  useClones: false,
});

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

const today = new Date().toISOString().split("T")[0];

const SYSTEM_PROMPT = `You are a highly professional, enterprise-grade AI Sales Assistant developed specifically for an Auto Shop POS (Point of Sale) system operating in Myanmar. Your primary purpose is to analyze real-time financial data, sales metrics, payment behaviors, and product performance by intelligently executing backend tool functions.

You act as a grounded business companion. Strictly rely on the data payload returned by the database tools. Never hallucinate, estimate, or invent numerical values, percentages, dates, names, or performance metrics. If the database returns zero or null, explicitly report that no data exists for that metric.

Today's current date is ${today}. Use this static timestamp as your anchor point for all relative date and time-range calculations.

===== LANGUAGE, TRANSLATION & STYLE RULES =====
1. **Language & Tone:** Always communicate exclusively, politely, and naturally in the Myanmar language (မြန်မာလိုသာ လုံးဝပြန်ကြားပေးပါ). Avoid machine translation, robotic phrasing, or overly formal bookish Burmese. Write in a warm, helpful, and natural conversational style as an experienced local shop manager or supervisor (လူတစ်ဦးနှင့်တစ်ဦး သဘာဝကျကျ မိတ်ဆွေလို စကားပြောဆိုနေသည့် ပုံစံဖြင့် ရေးသားပေးပါ). 
   - Avoid repeating mechanical honorifics like "ခင်ဗျာ၊" or "ရှင်၊" at the beginning of sentences.
   - Use soft and context-appropriate sentence endings naturally (e.g., "ပါခင်ဗျာ"၊ "စစ်ဆေးပေးထားပါတယ်ခင်ဗျာ"၊ "မေးမြန်းနိုင်ပါတယ်ခင်ဗျာ")။

2. **Term Mapping & Localization:** Convert technical and database terminology into everyday Myanmar automotive/accounting terms. Never render literal translations of English keys.
   - Cash Payment → လက်ငင်း ငွေသားပေးချေမှု
   - Mobile Banking / Card → မိုဘိုင်းဘဏ်စနစ် / ကဒ်ဖြင့် ပေးချေမှု
   - Sale Report → အရောင်းအစီရင်ခံစာ
   - Discount → လျှော့စျေး / Discount
   - Credit Sale → အကြွေးရောင်းအား / စာရင်းကျန်

3. **Strict Standard Report Layout:** When responding to standard sales summary queries (daily, weekly, monthly, or custom range), bypass greeting filler and output strictly using this precise bullet-point format:

   ဒီလအတွက် အရောင်းအစီရင်ခံစာ အနှစ်ချုပ်မှာ အောက်ပါအတိုင်း ဖြစ်ပါတယ်ခင်ဗျာ -
   • စုစုပေါင်း ရောင်းအားပမာဏ: [finalAmountFormatted]
   • ကဒ်/Mobile Banking ဖြင့် ပေးချေမှု: [totalPaidAmountFormatted (for cards/mobile banking)]
   • လက်ငင်းငွေသား (Cash) ဖြင့် ပေးချေမှု: [totalPaidAmountFormatted (for cash)]
   • လျှော့စျေး (Discount): [discountFormatted]
   • အကြွေးရရန်ရှိငွေ: [creditAmountFormatted]
   • စုစုပေါင်း အော်ဒါ (Order) အရေအတွက်: [Myanmar Digits] ခု
   • စုစုပေါင်း ရောင်းရသည့် ပစ္စည်းအရေအတွက်: [Myanmar Digits] ခု

   ကျေးဇူးတင်ပါတယ်ခင်ဗျာ။

4. **Myanmar Currency & Digit Formatting:**
   - Always prioritize the exact pre-formatted currency strings ending in \`Formatted\` (e.g., \`finalAmountFormatted\`, \`discountFormatted\`) returned by the tools. Copy them **character-for-character**. Never rewrite, alter, or replace words in pre-formatted strings (e.g., do NOT change "ထောင်" to "မြောက်").
   - Truncate \`.00\` for whole numbers. Expose floating decimals only when representing partial cents/pya.
   - Format countable items and quantities using Myanmar digits with appropriate classifiers (e.g., ၁၅ ခု, ၂၃ မျိုး, ၅ စောင်).

===== TOOL EXECUTION & DATE RANGE CONVERSION =====
5. **Immediate Execution:** Trigger tools instantly upon receiving data-specific requests without sending pre-conversational filler text.
6. **Storefront Scope:** If \`[Storefront: <ID>]\` exists in system context, automatically attach this ID to outbound tool calls without asking the user.
7. **Relative Date Handling (Anchor Date: \${today}):**
   - Today / "ဒီနေ့" → exact current date (\${today}).
   - Yesterday / "မနေ့က" → exact previous calendar date.
   - Last week / "ပြီးခဲ့တဲ့အပတ်" → Monday through Sunday of the previous calendar week.
   - This month / "ဒီလ" → 1st day of the current month to \${today}.
   - Last month / "ပြီးခဲ့တဲ့လ" → 1st day to the last day of the previous calendar month.
   - Past 30 days / "လွန်ခဲ့တဲ့ရက် ၃၀" → 30 days prior up to \${today}.
   - Convert all natural date expressions to strict 'YYYY-MM-DD' strings for \`startDate\` and \`endDate\` parameters.

===== ROUTING GUIDE =====
- \`getSaleReport\`: Overall sales revenue, order totals, invoices, tax, overall discount.

===== EXCEPTION & SECURITY HANDLERS =====
- **Empty Result (No data returned):** Do NOT output a generic "ဒီကာလအတွင်း". Instead, dynamically adapt the sentence based on the user's requested timeframe (e.g. if the user asked about "ဒီတစ်ပတ်", reply "ဒီတစ်ပတ်အတွင်း မည်သည့် အရောင်းအချက်အလက်မှ မရှိသေးပါခင်ဗျာ။"; if they asked about "ဒီနေ့", reply "ဒီနေ့အတွင်း မည်သည့် အရောင်းအချက်အလက်မှ မရှိသေးပါခင်ဗျာ။"; if they asked about "ဒီလ", reply "ဒီလအတွင်း မည်သည့် အရောင်းအချက်အလက်မှ မရှိသေးပါခင်ဗျာ။").
- **Error Handlers:** "စနစ်စစ်ဆေးမှု ခေတ္တအဆင်မပြေဖြစ်နေပါသဖြင့် ရှာဖွေမှုဘောင်ကို အနည်းငယ်ပြင်ပြီး ထပ်မံကြိုးစားပေးပါခင်ဗျာ။"
- Never expose API internal variables, backend tool names, or code paths in user responses.`;

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "getSaleReport",
      description:
        "Get aggregate sale totals including finalAmount, paidAmount, discount, extraChange, and order counts (total, credit, paid orders). Good for general sales overview.",
      parameters: {
        type: "object",
        properties: {
          storefrontId: {
            type: "string",
            description: "Optional storefront ID. Omit for all storefronts.",
          },
          startDate: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD format).",
          },
          endDate: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD format).",
          },
        },
      },
    },
  },
  /*
  {
    type: "function",
    function: {
      name: "getPaymentMethodReport",
      description:
        "Get payment method breakdown for paid (non-credit) orders. Returns totals per payment method (cash, bank transfer, etc.) with paidAmount per method.",
      parameters: {
        type: "object",
        properties: {
          storefrontId: {
            type: "string",
            description: "Optional storefront ID. Omit for all storefronts.",
          },
          startDate: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD format).",
          },
          endDate: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD format).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getCreditSaleReport",
      description:
        "Get credit sale summary with total amounts, paid amounts, remaining balances, and order count. No per-payment-method breakdown.",
      parameters: {
        type: "object",
        properties: {
          storefrontId: {
            type: "string",
            description: "Optional storefront ID. Omit for all storefronts.",
          },
          startDate: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD format).",
          },
          endDate: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD format).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getProductSalesReport",
      description:
        "Get top selling products with productName, totalQuantity, totalRevenue, and totalProfit. Returns only top 5 products plus aggregate totals. Good for best-sellers and profit analysis.",
      parameters: {
        type: "object",
        properties: {
          storefrontId: {
            type: "string",
            description: "Optional storefront ID. Omit for all storefronts.",
          },
          startDate: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD format).",
          },
          endDate: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD format).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getCreditPersonaProductReport",
      description:
        "Get top 5 products purchased by a specific credit persona/customer. Returns productName and totalQuantity only. Requires creditPersonaId.",
      parameters: {
        type: "object",
        properties: {
          creditPersonaId: {
            type: "string",
            description: "Required. The credit persona/customer ID.",
          },
          storefrontId: {
            type: "string",
            description: "Optional storefront ID. Omit for all storefronts.",
          },
          startDate: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD format).",
          },
          endDate: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD format).",
          },
        },
        required: ["creditPersonaId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSaleProductsAnalyticsByCreditPerson",
      description:
        "Get top 5 products sold on credit with productName, totalQuantity, and uniqueCreditPersonsCount. No per-person details.",
      parameters: {
        type: "object",
        properties: {
          storefrontId: {
            type: "string",
            description: "Optional storefront ID. Omit for all storefronts.",
          },
          inventoryId: {
            type: "string",
            description:
              "Optional inventory/product ID to filter by specific product.",
          },
          startDate: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD format).",
          },
          endDate: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD format).",
          },
        },
      },
    },
  },
  */
];

async function callOpenRouter(messages) {
  const body = {
    model: MODEL,
    messages,
    tools: toolDefinitions,
    tool_choice: "auto",
    temperature: 0,
  };

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://autoshop-pos.app",
      "X-Title": "AutoShop POS",
      "X-OpenRouter-Cache": "true",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function executeTool(toolName, args) {
  const { storefrontId, startDate, endDate, creditPersonaId, inventoryId } =
    args || {};

  switch (toolName) {
    case "getSaleReport":
      return aiSaleReport.getSaleReportSummary(
        storefrontId,
        startDate,
        endDate,
      );
    /*
    case "getPaymentMethodReport":
      return aiSaleReport.getPaymentMethodReport(
        storefrontId,
        startDate,
        endDate,
      );
    case "getCreditSaleReport":
      return aiSaleReport.getCreditSaleReport(storefrontId, startDate, endDate);
    case "getProductSalesReport":
      return aiSaleReport.getProductSalesReport(
        storefrontId,
        startDate,
        endDate,
      );
    case "getCreditPersonaProductReport":
      return aiSaleReport.getCreditPersonaProductReport(
        creditPersonaId,
        storefrontId,
        startDate,
        endDate,
      );
    case "getSaleProductsAnalyticsByCreditPerson":
      return aiSaleReport.getSaleProductsAnalyticsByCreditPerson(
        storefrontId,
        inventoryId,
        startDate,
        endDate,
      );
    */
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function processAiChat(
  message,
  conversationHistory = [],
  defaults = {},
) {
  const cacheKey = `${defaults.storefrontId || ""}:${message.trim()}`;
  const cached = aiCache.get(cacheKey);
  if (cached) {
    console.log(`[AICache] HIT for key: ${cacheKey}`);
    return cached;
  }

  // Convert frontend conversation history to OpenRouter format
  // Frontend sends [{ role: "user"|"ai", content, ... }, ...]
  // OpenRouter expects [{ role: "user"|"assistant", content }, ...]
  const historyMessages = (conversationHistory || [])
    .filter((msg) => msg.role === "user" || msg.role === "ai")
    .map((msg) => ({
      role: msg.role === "ai" ? "assistant" : "user",
      content: msg.content,
    }));

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyMessages,
    {
      role: "user",
      content: defaults.storefrontId
        ? `[Storefront: ${defaults.storefrontId}]\n${message}`
        : message,
    },
  ];

  let currentMessages = [...messages];
  let toolCallsUsed = [];

  const maxIterations = 5;

  for (let i = 0; i < maxIterations; i++) {
    const response = await callOpenRouter(currentMessages);
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error("No response from AI");
    }

    const assistantMessage = choice.message;
    currentMessages.push(assistantMessage);

    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      const result = {
        response:
          assistantMessage.content ||
          "I don't have enough information to answer that.",
        toolCalls: toolCallsUsed,
      };
      console.log(`[AICache] SET for key: ${cacheKey}`);
      aiCache.set(cacheKey, result);
      return result;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      const mergedArgs = { ...defaults, ...args };
      const result = await executeTool(toolName, mergedArgs);
      toolCallsUsed.push(toolName);

      currentMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  const finalResponse = currentMessages[currentMessages.length - 1];
  const result = {
    response:
      finalResponse.content ||
      "I processed your request but couldn't generate a proper response.",
    toolCalls: toolCallsUsed,
  };
  console.log(`[AICache] SET for key: ${cacheKey}`);
  aiCache.set(cacheKey, result);
  return result;
}
