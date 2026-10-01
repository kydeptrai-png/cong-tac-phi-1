# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Any path not explicitly matched is denied for both read and write (`allow read, write: if false;`).
2. **Strict Owner Isolation**: Every document in `/userBackups/{userId}`, `/users/{userId}`, and `/users/{userId}/expenses/{expenseId}` belongs exclusively to `userId == request.auth.uid` with a verified email (`request.auth.token.email_verified == true`).
3. **Parent Gate & Relational Consistency**: Every subcollection document `/users/{userId}/expenses/{expenseId}` requires `request.auth.uid == userId` and `data.ownerId == request.auth.uid` and `data.id == expenseId`.
4. **No Raw Base64 Blobs in Firestore**: `imageUrls` and `images` arrays are bounded (`size() <= 30`) and each first element (if non-empty) must be a bounded URL string (`size() <= 2048`), preventing 1MB payload exhaustion.
5. **Server Timestamp Enforcement (`updatedAt == request.time`)**: Every create and update on `/users/{userId}/expenses/{expenseId}` must use `serverTimestamp()` (`data.updatedAt == request.time`) for Last-Write-Wins (LWW) ordering across devices.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null` writing to `/users/u1/expenses/exp1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'u1', token: { email_verified: false } }` -> `PERMISSION_DENIED`.
3. **Cross-User Read/List**: `auth.uid = 'u2'` reading `/users/u1/expenses/exp1` -> `PERMISSION_DENIED`.
4. **OwnerId Spoofing on Create**: `auth.uid = 'u1'` creating `/users/u1/expenses/exp1` with `ownerId: 'u2'` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: Payload includes `isAdmin: true` not in `hasOnly()` allowlist -> `PERMISSION_DENIED`.
6. **ID Poisoning**: Document ID `expenseId` with >128 chars or invalid regex chars -> `PERMISSION_DENIED`.
7. **Forged Client Timestamp**: `updatedAt` set to a future timestamp instead of `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: Updating `ownerId` or `id` on an existing expense document -> `PERMISSION_DENIED`.
9. **Description / Comment Overflow**: `description` with 50,000 characters (`> 2000`) -> `PERMISSION_DENIED`.
10. **Unbounded Image Array**: `imageUrls` with 100 items (`> 30`) -> `PERMISSION_DENIED`.
11. **Invalid Day/Month Range**: `day: 45` or `monthNum: 15` -> `PERMISSION_DENIED`.
12. **Blanket Collection List**: Listing `/users/u1/expenses` without `resource.data.ownerId == request.auth.uid` -> `PERMISSION_DENIED`.
