// Money moved between the household's own accounts to avoid an overdraft (Safe to spend).
import { and, asc, eq } from "drizzle-orm";
import { assertOwned, type Db, type HouseholdScope } from "../db";
import { accounts, cashMoves } from "../schema";

export type CashMoveRow = typeof cashMoves.$inferSelect;
export type NewCashMove = Omit<CashMoveRow, "id" | "householdId" | "createdAt" | "updatedAt">;

export async function listCashMoves(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(cashMoves)
    .where(eq(cashMoves.householdId, scope.householdId))
    .orderBy(asc(cashMoves.moveDate), asc(cashMoves.createdAt));
}

/** Record a move between two of this household's accounts (throws NotOwnedError for any other). */
export async function addCashMove(db: Db, scope: HouseholdScope, move: NewCashMove) {
  await assertOwned(db, scope, accounts, move.fromAccountId, "account");
  await assertOwned(db, scope, accounts, move.toAccountId, "account");
  const [row] = await db
    .insert(cashMoves)
    .values({ householdId: scope.householdId, ...move })
    .returning();
  return row!;
}

/** Delete one move; returns it (for Undo) or null when it was not this household's. */
export async function deleteCashMove(db: Db, scope: HouseholdScope, id: string) {
  const [row] = await db
    .delete(cashMoves)
    .where(and(eq(cashMoves.householdId, scope.householdId), eq(cashMoves.id, id)))
    .returning();
  return row ?? null;
}
