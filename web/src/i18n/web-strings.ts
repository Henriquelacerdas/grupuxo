import type { Message } from "./messages";
import * as auth from "./web/auth";
import * as common from "./web/common";
import * as house from "./web/house";
import * as settings from "./web/settings";
import * as tasks from "./web/tasks";

// Textos que não existem no app (Localizable.xcstrings): cada área do web tem o seu arquivo em `web/`.
const areas = [common, auth, tasks, house, settings];

export const WEB_EN: Readonly<Record<string, Message>> = Object.assign({}, ...areas.map((area) => area.EN));
export const WEB_PT: Readonly<Record<string, Message>> = Object.assign({}, ...areas.map((area) => area.PT));
