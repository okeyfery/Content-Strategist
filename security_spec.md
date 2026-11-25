# Security Specification — Content Radar Studio (Firestore Rules)

## 1. Data Invariants
1. **Strict User Isolation**: All workspace data resides under `/users/{userId}/...`. Only the authenticated, email-verified user whose `request.auth.uid == userId` may read, list, create, update, or delete their own documents.
2. **Referential Integrity (No Orphans)**: Every `WatchlistAccount`, `OutlierItem`, `AuditReport`, and `ContentDraft` MUST reference an existing parent `Brand` at `/users/{userId}/brands/{brandId}` on creation.
3. **Immutable Ownership & Creation Time**: `ownerId`, `brandId`, and `createdAt` can NEVER be altered after document creation.
4. **Temporal Integrity**: `createdAt` on create and `updatedAt` on create/update MUST equal `request.time` (server timestamp).
5. **Terminal State Locking**: A `ContentDraft` whose `status == 'archived'` is locked from further updates (may only be deleted).
6. **Volumetric & Schema Guardrails**: No shadow/ghost keys allowed (`keys().hasAll(...) && keys().hasOnly(...)`), every string has explicit `.size()` bounds matching `firebase-blueprint.json`, every ID matches `^[a-zA-Z0-9_\-]+$`, and every array is size-capped with element type checks.

## 2. The "Dirty Dozen" Attack Payloads (All Must Yield PERMISSION_DENIED)
1. **Cross-User Read**: User B attempts `get` on `/users/{userA}/brands/{brandId}`.
2. **Blanket List Scrape**: User B attempts `list` on `/users/{userA}/watchlistAccounts`.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts `create` on `/users/{uid}/brands/b1`.
4. **Owner Spoofing**: User A creates `/users/{userA}/brands/b1` with `ownerId: "userB"`.
5. **Ghost / Shadow Field Injection**: User A creates a brand with extra key `isAdmin: true`.
6. **Orphaned Watchlist Account**: User A creates a `watchlistAccounts` document referencing a non-existent `brandId: "ghost_brand"`.
7. **ID Poisoning**: User A writes to `/users/{userA}/brands/invalid$id!with*spaces` or a 200-char ID.
8. **Backdated Timestamp Spoofing**: User A creates an outlier with client-side `createdAt` instead of `request.time`.
9. **Immutable Field Mutation**: User A updates a `watchlistAccounts` document attempting to change `ownerId` or `brandId` or `createdAt`.
10. **Denial-of-Wallet String Overflow**: User A creates a brand with a 10,000-character `name` exceeding `maxLength: 120`.
11. **Array Type / Bound Poisoning**: User A creates a `ContentDraft` with 25 `hooks` (exceeding max 6) or numeric element `[123]`.
12. **Terminal State Violation**: User A attempts to update a `ContentDraft` whose existing `status` is `'archived'`.
