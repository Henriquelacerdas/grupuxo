import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import type { IncomingMessage } from "../incoming-message.ts";
import { WhatsAppLinkError, type LinkTokenStore, type WhatsAppLinkStore } from "../ports.ts";
import { extractToken, generateToken, hashToken, systemRandomBytes, type RandomBytes } from "./link-token-codec.ts";

export type LinkConfigErrorCode = "invalidBotPhoneNumber" | "invalidTokenLifetime";

export class LinkConfigError extends Error {
  readonly code: LinkConfigErrorCode;

  constructor(code: LinkConfigErrorCode) {
    super(code);
    this.name = "LinkConfigError";
    this.code = code;
  }
}

export interface LinkConfig {
  /** Número do bot só com dígitos, como o `wa.me` espera (`5511999998888`). */
  readonly botPhoneNumber: string;
  readonly tokenLifetimeSeconds: number;
}

/** Aceita um `+` inicial e o descarta. O número precisa ter de 8 a 15 dígitos (E.164 sem formatação). */
export function createLinkConfig(botPhoneNumber: string, tokenLifetimeSeconds = 15 * 60): LinkConfig {
  const digits = botPhoneNumber.startsWith("+") ? botPhoneNumber.slice(1) : botPhoneNumber;
  if (!/^[0-9]{8,15}$/.test(digits)) throw new LinkConfigError("invalidBotPhoneNumber");
  if (!(tokenLifetimeSeconds > 0) || !Number.isFinite(tokenLifetimeSeconds)) throw new LinkConfigError("invalidTokenLifetime");
  return { botPhoneNumber: digits, tokenLifetimeSeconds };
}

export interface LinkInvitation {
  /** `https://wa.me/<numero>?text=<mensagem com o token>`. É o único lugar onde o token existe em claro. */
  readonly url: string;
  readonly expiresAt: Instant;
}

// Só ASCII seguro: `encodeURIComponent` deixaria `!'()*` passarem.
function percentEncode(text: string): string {
  return [...Buffer.from(text, "utf8")]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

/**
 * Vínculo número ↔ morador por token de uso único (BACKEND.md, seção 8). Só traduz o canal em chamadas aos
 * ports; o `userID` vem sempre do token, nunca do texto da mensagem.
 */
export class WhatsAppLinker {
  static readonly linkedReply = "Pronto! Seu WhatsApp está conectado ao Grupuxo. Pergunte, por exemplo: quais são minhas tarefas?";
  // Redação neutra de propósito: vale também para a nova tentativa depois de uma falha ao enviar a confirmação.
  static readonly alreadyLinkedReply = "Este número já está conectado ao Grupuxo.";
  static readonly invalidTokenReply = "Link inválido ou expirado. Gere outro no app, em Perfil › Conectar WhatsApp.";
  static readonly userHasOtherNumberReply = "Sua conta já tem outro número conectado. Desconecte no app e tente de novo.";

  private readonly config: LinkConfig;
  private readonly tokens: LinkTokenStore;
  private readonly links: WhatsAppLinkStore;
  private readonly now: () => Instant;
  private readonly randomBytes: RandomBytes;

  constructor(
    config: LinkConfig, tokens: LinkTokenStore, links: WhatsAppLinkStore, now: () => Instant,
    randomBytes: RandomBytes = systemRandomBytes,
  ) {
    this.config = config;
    this.tokens = tokens;
    this.links = links;
    this.now = now;
    this.randomBytes = randomBytes;
  }

  /**
   * Gera o convite para o morador autenticado (futuro `POST /me/whatsapp/link`).
   * Lança `WhatsAppLinkError("userAlreadyLinked")` se ele já tem número conectado.
   */
  async issueInvitation(userID: UserID): Promise<LinkInvitation> {
    if ((await this.links.linkForUser(userID)) !== null) throw new WhatsAppLinkError("userAlreadyLinked");
    const token = generateToken(this.randomBytes);
    const expiresAt = this.now() + this.config.tokenLifetimeSeconds * 1000;
    await this.tokens.save({ tokenHash: hashToken(token), userID, expiresAt });
    return { url: this.url(token), expiresAt };
  }

  /**
   * Devolve `null` se a mensagem não traz token (o worker segue o fluxo normal); senão, a resposta ao remetente.
   *
   * Consumir o token e criar o vínculo são duas chamadas: se `create` falhar depois do `consume`, o token fica
   * queimado e o morador gera outro. No DynamoDB o adaptador pode juntar as duas coisas num `TransactWriteItems`.
   */
  async handle(message: IncomingMessage): Promise<string | null> {
    const token = extractToken(message.text);
    if (token === null) return null;

    // Antes do consume, para um número já vinculado não queimar um token que outro número ainda pode usar.
    if ((await this.links.linkForPhone(message.phoneE164)) !== null) return WhatsAppLinker.alreadyLinkedReply;
    const userID = await this.tokens.consume(hashToken(token), this.now());
    if (userID === null) return WhatsAppLinker.invalidTokenReply;
    try {
      // Enviar o token é o aceite: `consentedAt` é o horário da mensagem do usuário.
      await this.links.create({ userID, phoneE164: message.phoneE164, consentedAt: message.receivedAt, linkedAt: this.now() });
    } catch (error) {
      if (error instanceof WhatsAppLinkError) {
        return error.code === "phoneAlreadyLinked" ? WhatsAppLinker.alreadyLinkedReply : WhatsAppLinker.userHasOtherNumberReply;
      }
      throw error;
    }
    return WhatsAppLinker.linkedReply;
  }

  private url(token: string): string {
    const text = `Conectar meu WhatsApp ao Grupuxo. Código: ${token}`;
    return `https://wa.me/${this.config.botPhoneNumber}?text=${percentEncode(text)}`;
  }
}
