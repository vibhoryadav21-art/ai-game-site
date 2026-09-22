import LearnModule from "@/components/learn/LearnModule";
import { spanishCourse } from "@/lib/learn/spanish";

export default function SpanishLearnPage() {
  return <LearnModule course={spanishCourse} />;
}