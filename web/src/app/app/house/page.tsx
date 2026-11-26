import { HousePage } from "@/features/house/house-page";
import { localizedTitle } from "@/features/house/metadata";

export const generateMetadata = () => localizedTitle("Casa");

export default function Page() {
  return <HousePage />;
}
