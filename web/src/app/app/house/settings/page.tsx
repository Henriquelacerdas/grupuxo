import { HouseSettings } from "@/features/house/house-settings";
import { localizedTitle } from "@/features/house/metadata";

export const generateMetadata = () => localizedTitle("Ajustes da casa");

export default function Page() {
  return <HouseSettings />;
}
