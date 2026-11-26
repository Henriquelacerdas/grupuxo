import { RoomDetail } from "@/features/rooms/room-detail";
import { localizedTitle } from "@/features/house/metadata";

export const generateMetadata = () => localizedTitle("Cômodo");

export default async function Page({ params }: { params: Promise<{ roomID: string }> }) {
  const { roomID } = await params;
  return <RoomDetail roomID={roomID} />;
}
