// Ready-made prompts for people new to AI apps. Each one is a small lesson in
// writing a good prompt: say who the AI should be, give the context, and ask for
// a shape of answer. The parts in [square brackets] are for the user to fill in;
// the assistant selects the first one after inserting a template.

import { getLang } from "../i18n/core";

export interface PromptTemplate {
  id: string;
  title: [tr: string, en: string];
  text: [tr: string, en: string];
}

export interface PromptCategory {
  id: string;
  name: [tr: string, en: string];
  /** A 24×24 stroked path for the category chip. */
  icon: string;
  prompts: PromptTemplate[];
}

export const PROMPT_LIBRARY: PromptCategory[] = [
  {
    id: "start",
    // Short in both languages: the six category tabs share one row (dashboard#18).
    name: ["Başlangıç", "Basics"],
    icon: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    prompts: [
      {
        id: "explain",
        title: ["Basitçe anlat", "Explain it simply"],
        text: [
          "[konu] nedir? Hiç bilmeyen birine anlatır gibi, günlük hayattan bir örnekle ve en fazla 5 cümleyle açıkla.",
          "What is [topic]? Explain it as if to someone who has never heard of it, with an everyday example, in at most 5 sentences.",
        ],
      },
      {
        id: "steps",
        title: ["Adım adım rehber", "Step-by-step guide"],
        text: [
          "[yapmak istediğin şey] için adım adım bir rehber yaz. Her adım tek cümle olsun, gereken malzemeleri en başta listele.",
          "Write a step-by-step guide to [what you want to do]. Keep each step to one sentence and list what I need at the start.",
        ],
      },
      {
        id: "compare",
        title: ["İki seçeneği karşılaştır", "Compare two options"],
        text: [
          "[seçenek 1] ile [seçenek 2] arasında kararsızım. Benim için önemli olan: [kriterler]. Artılarını ve eksilerini bir tabloyla karşılaştır, sonunda kısa bir öneri ver.",
          "I can't decide between [option 1] and [option 2]. What matters to me: [criteria]. Compare their pros and cons in a table and end with a short recommendation.",
        ],
      },
      {
        id: "better-prompt",
        title: ["Promptumu iyileştir", "Improve my prompt"],
        text: [
          "Bir yapay zekâya şunu sormak istiyorum: \"[sorun]\". Bu soruyu daha iyi bir yanıt alacağım şekilde yeniden yaz ve neyi neden değiştirdiğini kısaca açıkla.",
          "I want to ask an AI this: \"[your question]\". Rewrite it so I get a better answer, and briefly explain what you changed and why.",
        ],
      },
    ],
  },
  {
    id: "write",
    name: ["Yazı", "Writing"],
    icon: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    prompts: [
      {
        id: "email",
        title: ["E-posta yaz", "Write an email"],
        text: [
          "[kime] bir e-posta yaz. Amacım: [amaç]. Ton: [kibar / samimi / resmi]. Kısa tut ve bir konu satırı öner.",
          "Write an email to [who]. My goal: [goal]. Tone: [polite / friendly / formal]. Keep it short and suggest a subject line.",
        ],
      },
      {
        id: "fix",
        title: ["Yazımı düzelt", "Fix my writing"],
        text: [
          "Aşağıdaki metnin yazım ve dil bilgisi hatalarını düzelt, anlamını değiştirme. Sonra değiştirdiklerini madde madde listele.\n\n[metin]",
          "Fix the spelling and grammar in the text below without changing its meaning. Then list what you changed.\n\n[text]",
        ],
      },
      {
        id: "summarize",
        title: ["Özetle", "Summarize"],
        text: [
          "Aşağıdaki metni 3 maddede özetle, en sonda tek cümlelik bir sonuç yaz.\n\n[metin]",
          "Summarize the text below in 3 bullet points, then one sentence with the takeaway.\n\n[text]",
        ],
      },
      {
        id: "post",
        title: ["Sosyal medya gönderisi", "Social media post"],
        text: [
          "[platform] için [konu] hakkında kısa bir gönderi yaz. Hedef kitle: [kim]. 3 farklı versiyon ver, her birinde farklı bir giriş cümlesi olsun.",
          "Write a short [platform] post about [topic] for [audience]. Give me 3 versions, each with a different opening line.",
        ],
      },
    ],
  },
  {
    id: "learn",
    name: ["Öğren", "Learn"],
    icon: "M2 7l10-4 10 4-10 4zM6 9v5c0 1.7 2.7 3 6 3s6-1.3 6-3V9",
    prompts: [
      {
        id: "quiz",
        title: ["Beni sına", "Quiz me"],
        text: [
          "[konu] hakkında bana 5 soruluk çoktan seçmeli bir test hazırla. Soruları tek tek sor, cevabımı bekle, sonra doğru mu yanlış mı açıkla.",
          "Make a 5-question multiple-choice quiz on [topic]. Ask one question at a time, wait for my answer, then tell me whether I was right and why.",
        ],
      },
      {
        id: "plan",
        title: ["Çalışma planı", "Study plan"],
        text: [
          "[sınav / konu] için [gün sayısı] günlük bir çalışma planı hazırla. Günde [saat] saat ayırabiliyorum. Plan bir tablo olsun ve tekrar günleri içersin.",
          "Make a [number]-day study plan for [exam / topic]. I have [hours] hours a day. Put it in a table and include review days.",
        ],
      },
      {
        id: "language",
        title: ["Dil pratiği", "Language practice"],
        text: [
          "Benimle [dil] dilinde basit bir sohbet yap. Seviyem: [başlangıç / orta]. Her cevabımdaki hataları kibarca düzelt ve bir sonraki soruyu sor.",
          "Have a simple conversation with me in [language]. My level: [beginner / intermediate]. Gently correct my mistakes in each reply, then ask the next question.",
        ],
      },
    ],
  },
  {
    id: "work",
    name: ["İş", "Work"],
    icon: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
    prompts: [
      {
        id: "meeting",
        title: ["Toplantı notlarından görevler", "Tasks from meeting notes"],
        text: [
          "Aşağıdaki toplantı notlarından kararları ve görevleri çıkar. Görevleri \"kim · ne · ne zamana\" biçiminde bir tabloda ver.\n\n[notlar]",
          "Pull the decisions and tasks out of the meeting notes below. Put the tasks in a \"who · what · by when\" table.\n\n[notes]",
        ],
      },
      {
        id: "project",
        title: ["Proje planı", "Project plan"],
        text: [
          "[proje] için bir plan çıkar: hedef, adımlar, her adımın süresi ve riskler. [tarih] tarihine kadar bitmesi gerekiyor.",
          "Draft a plan for [project]: goal, steps, how long each step takes, and the risks. It has to be done by [date].",
        ],
      },
      {
        id: "reply",
        title: ["Zor bir mesaja cevap", "Reply to a tough message"],
        text: [
          "Şu mesaja nazik ama net bir cevap yazmama yardım et. Benim istediğim: [ne istiyorsun].\n\nMesaj: [mesaj]",
          "Help me write a polite but clear reply to this message. What I want: [what you want].\n\nMessage: [message]",
        ],
      },
    ],
  },
  {
    id: "code",
    name: ["Kod", "Code"],
    icon: "M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14",
    prompts: [
      {
        id: "explain-code",
        title: ["Bu kodu açıkla", "Explain this code"],
        text: [
          "Aşağıdaki [dil] kodunun ne yaptığını satır satır, yeni başlayan birine anlatır gibi açıkla.\n\n```\n[kod]\n```",
          "Explain what this [language] code does, line by line, as if to a beginner.\n\n```\n[code]\n```",
        ],
      },
      {
        id: "bug",
        title: ["Hatayı bul", "Find the bug"],
        text: [
          "Bu kod [beklenen] yapması gerekirken [olan] yapıyor. Hatayı bul, nedenini açıkla ve düzeltilmiş halini ver.\n\n```\n[kod]\n```\n\nHata mesajı: [varsa hata]",
          "This code should [expected] but instead it [actual]. Find the bug, explain why it happens and give me the fixed version.\n\n```\n[code]\n```\n\nError: [error, if any]",
        ],
      },
      {
        id: "function",
        title: ["Fonksiyon yaz", "Write a function"],
        text: [
          "[dil] dilinde, [girdi] alıp [çıktı] döndüren bir fonksiyon yaz. Kenar durumları düşün, kısa açıklama ve 2 örnek kullanım ekle.",
          "Write a [language] function that takes [input] and returns [output]. Handle the edge cases and add a short explanation with 2 example calls.",
        ],
      },
    ],
  },
  {
    id: "daily",
    name: ["Günlük", "Everyday"],
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
    prompts: [
      {
        id: "recipe",
        title: ["Elimdekilerle yemek", "Cook with what I have"],
        text: [
          "Evde şunlar var: [malzemeler]. [süre] dakikada yapabileceğim 3 yemek öner, birinin tarifini adım adım ver.",
          "I have these at home: [ingredients]. Suggest 3 dishes I can make in [time] minutes and give the recipe for one, step by step.",
        ],
      },
      {
        id: "trip",
        title: ["Gezi planı", "Trip plan"],
        text: [
          "[şehir] için [gün] günlük bir gezi planı hazırla. Bütçem [bütçe], ilgi alanlarım: [ilgi alanları]. Her günü sabah, öğle ve akşam olarak böl.",
          "Plan a [number]-day trip to [city]. My budget is [budget] and I like [interests]. Split each day into morning, afternoon and evening.",
        ],
      },
      {
        id: "gift",
        title: ["Hediye fikri", "Gift ideas"],
        text: [
          "[kime] için [bütçe] bütçeli 5 hediye fikri ver. Onun hakkında: [ilgi alanları]. Her fikrin neden uygun olduğunu tek cümleyle yaz.",
          "Give me 5 gift ideas for [who] on a [budget] budget. About them: [interests]. Say in one sentence why each one fits.",
        ],
      },
    ],
  },
];

export const pick = (pair: [string, string]) => pair[getLang() === "tr" ? 0 : 1];

/** The first [placeholder] in `text`, as a selection range. */
export function firstPlaceholder(text: string): [number, number] | null {
  const m = /\[[^\]\n]{1,60}\]/.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}
