import { TutorClient } from "@/components/TutorClient";

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const params = await searchParams;
  return <TutorClient autoStart={params.start === "1"} />;
}
