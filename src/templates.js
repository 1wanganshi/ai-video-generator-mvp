export const templates = [
  {
    id: "zen",
    name: "禅宗型",
    description: "留白、松烟墨色、慢节奏，适合哲理和修行内容。",
    stylePrompt: "minimal zen ink wash, quiet composition, mist, stone, pine, warm paper texture",
    colors: {
      background: "efe7d3",
      surface: "f8f3e8",
      primary: "1f2a24",
      secondary: "6f7d68",
      accent: "b08d57",
      text: "1f2a24"
    },
    music: "ambient-soft",
    subtitleStyle: "paper-band",
    transition: "fade",
    pacing: "slow"
  },
  {
    id: "mao",
    name: "毛选型",
    description: "红色海报、强对比、坚定叙事，适合观点表达。",
    stylePrompt: "revolutionary poster, bold red, sunburst, grain texture, strong silhouette",
    colors: {
      background: "8f1f16",
      surface: "f1d8a8",
      primary: "4f0d0b",
      secondary: "f2c166",
      accent: "d43b24",
      text: "fff4d6"
    },
    music: "march-low",
    subtitleStyle: "bold-band",
    transition: "cut",
    pacing: "firm"
  },
  {
    id: "tech",
    name: "科技感",
    description: "深色界面、光线网格、未来叙事，适合 AI 和商业内容。",
    stylePrompt: "cinematic technology, luminous grid, glass interface, cool light, precise geometry",
    colors: {
      background: "10141b",
      surface: "192333",
      primary: "d7e8ff",
      secondary: "6fa8ff",
      accent: "28d7c4",
      text: "eef6ff"
    },
    music: "pulse-clean",
    subtitleStyle: "glass-band",
    transition: "fade",
    pacing: "medium"
  },
  {
    id: "guofeng",
    name: "国风",
    description: "山水、朱砂、金线、卷轴感，适合文化和情绪内容。",
    stylePrompt: "chinese guofeng landscape, cinnabar and gold, scroll texture, elegant clouds",
    colors: {
      background: "efe1c1",
      surface: "fff6dc",
      primary: "2f2a22",
      secondary: "8b5e34",
      accent: "b8322a",
      text: "2f2a22"
    },
    music: "guqin-soft",
    subtitleStyle: "scroll-band",
    transition: "fade",
    pacing: "calm"
  }
];

export function getTemplate(templateId) {
  return templates.find((template) => template.id === templateId) ?? templates[0];
}
