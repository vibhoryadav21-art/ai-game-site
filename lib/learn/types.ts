export type LearnItem = {
  id: string;
  native: string;   // Devanagari for Hindi; the Spanish word itself for Spanish
  roman: string;     // Roman transliteration (same as native for Spanish)
  english: string;   // meaning
  level?: "A1" | "A2" | "B1" | "B2" | "C1"; // defaults to A1 if omitted
};

export type LearnCategory = {
  id: string;
  title: string;
  items: LearnItem[];
};

export type LanguageCourse = {
  slug: string;
  name: string;
  flag: string;
  categories: LearnCategory[];
};