import {
  Archive, ArrowLeftRight, Bed, BedDouble, Bell, BookOpen, Car, Check, ClipboardList, Coffee, Droplets, House, LockOpen, Monitor,
  Pencil, RefreshCw, ShowerHead, Sofa, Sparkles, Toilet, Trash2, TreePine, Tv, UserMinus, UserPlus, UtensilsCrossed, WashingMachine,
  X, Zap, Paintbrush, Refrigerator, type LucideIcon,
} from "lucide-react";
import type { RoomColor } from "@/lib/api/types";

// Os SF Symbols só podem ser usados nas plataformas da Apple. O `icon` do cômodo continua sendo o nome do SF
// Symbol (o mesmo que o app grava), e o web desenha o equivalente do Lucide.
export const ROOM_SYMBOLS: Readonly<Record<string, LucideIcon>> = {
  "house.fill": House,
  "bed.double.fill": BedDouble,
  "bed.double": Bed,
  "sofa.fill": Sofa,
  "tv.fill": Tv,
  desktopcomputer: Monitor,
  "books.vertical.fill": BookOpen,
  "refrigerator.fill": Refrigerator,
  "cabinet.fill": Archive,
  "spigot.fill": Droplets,
  "cup.and.saucer.fill": Coffee,
  "shower.fill": ShowerHead,
  "toilet.fill": Toilet,
  "washer.fill": WashingMachine,
  "trash.fill": Trash2,
  sparkles: Sparkles,
  "paintbrush.pointed.fill": Paintbrush,
  "car.fill": Car,
  "fork.knife": UtensilsCrossed,
  "tree.fill": TreePine,
};

/** Ícones escolhíveis ao criar ou editar cômodo (mesma ordem do app). */
export const ROOM_ICON_CHOICES = [
  "house.fill", "bed.double.fill", "sofa.fill", "tv.fill", "desktopcomputer", "books.vertical.fill", "refrigerator.fill", "cabinet.fill",
  "spigot.fill", "cup.and.saucer.fill", "shower.fill", "toilet.fill", "washer.fill", "trash.fill", "sparkles", "paintbrush.pointed.fill", "car.fill",
] as const;

export const NOTIFICATION_SYMBOLS: Readonly<Record<string, LucideIcon>> = {
  pencil: Pencil, trash: Trash2, bolt: Zap, swap: ArrowLeftRight, check: Check, x: X, join: UserPlus, leave: UserMinus,
  unlock: LockOpen, cycle: RefreshCw, summary: ClipboardList, bell: Bell,
};

export const roomColorVar = (color: RoomColor): string => `var(--room-${color})`;

/** Ícone branco num círculo da cor do cômodo (RoomIconView do app). */
export function RoomIcon({ icon, color, size = 40 }: { icon: string; color: RoomColor; size?: number }) {
  const Glyph = ROOM_SYMBOLS[icon] ?? House;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, background: roomColorVar(color) }}
    >
      <Glyph size={Math.round(size * 0.5)} strokeWidth={2.25} />
    </span>
  );
}
