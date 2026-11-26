// Where to send the visitor after an Add money or Move money request.
//
// Kept apart from the server action so the choice can be tested on its
// own. Only fixed addresses come out of here: a code is one of the fixed
// list in lib/errors.ts, never text from the visitor.

import type { MoveResult } from "./moves-core.ts";

/**
 * The address to go to once addMoney has answered.
 *   done      -> /app?notice=added
 *   replayed  -> /app?notice=replayed
 *   refused   -> /app/add-money?error=<code>
 */
export function pathAfterAddMoney(result: MoveResult): string {
  switch (result.status) {
    case "done":
      return "/app?notice=added";
    case "replayed":
      return "/app?notice=replayed";
    case "refused":
      return `/app/add-money?error=${encodeURIComponent(result.code)}`;
  }
}

/**
 * The address to go to once moveMoney has answered.
 *   done      -> /app?notice=moved
 *   replayed  -> /app?notice=replayed
 *   refused   -> /app/move-money?error=<code>
 */
export function pathAfterMoveMoney(result: MoveResult): string {
  switch (result.status) {
    case "done":
      return "/app?notice=moved";
    case "replayed":
      return "/app?notice=replayed";
    case "refused":
      return `/app/move-money?error=${encodeURIComponent(result.code)}`;
  }
}
