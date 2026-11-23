# MyWallet Database Schema

**Generated from the Mongoose models** (`backend/src/database/models`). Money fields end in `Minor` and are integers (stored as BigInt/Long) in the currency minor unit.

## Account (`accounts`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `name` | String | required |
| `type` | String | required, enum |
| `currency` | String | required, immutable |
| `openingBalanceMinor` | BigInt | required |
| `notes` | String |  |
| `hidden` | Boolean |  |
| `status` | String | enum |
| `lastReconciledAt` | Date |  |
| `lastStatementBalanceMinor` | BigInt |  |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"status":1}`, `{"userId":1,"name":1}` (unique)

## Attachment (`attachments`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `kind` | String | required, enum |
| `originalName` | String |  |
| `mimeType` | String | required, enum |
| `sizeBytes` | Number | required |
| `sha256` | String | required |
| `storageKey` | String | required |
| `transactionId` | ObjectId | ref Transaction |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"transactionId":1}`

## AuditLog (`auditlogs`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | indexed, ref User |
| `actorRole` | String | enum |
| `action` | String | required |
| `entity` | String |  |
| `entityId` | ObjectId |  |
| `requestId` | String |  |
| `ipPrefix` | String |  |
| `meta` | Mixed |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `version` | Number |  |

Indexes: `{"userId":1}`, `{"userId":1,"createdAt":-1}`, `{"action":1,"createdAt":-1}`

## Bill (`bills`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `name` | String | required |
| `category` | String | enum |
| `expectedAmountMinor` | BigInt | required |
| `currency` | String | required |
| `categoryId` | ObjectId | ref Category |
| `accountId` | ObjectId | ref Account |
| `recurrence.frequency` | String | required, enum |
| `recurrence.intervalDays` | Number |  |
| `recurrence.startDate` | Date | required |
| `recurrence.endDate` | Date |  |
| `recurrence.timezone` | String |  |
| `nextDueDate` | Date | required |
| `reminderDaysBefore` | Array |  |
| `status` | String | enum |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"status":1,"nextDueDate":1}`

## BillingSubscription (`billingsubscriptions`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, unique, ref User, immutable |
| `planCode` | String | enum |
| `status` | String | enum |
| `trialEndsAt` | Date |  |
| `trialUsed` | Boolean |  |
| `currentPeriodEnd` | Date |  |
| `cancelAtPeriodEnd` | Boolean |  |
| `pendingPlanCode` | String | enum |
| `provider` | String |  |
| `providerCustomerId` | String |  |
| `providerSubscriptionId` | String |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1}` (unique)

## Budget (`budgets`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `name` | String | required |
| `period` | String | required, enum |
| `categoryIds` | Array | ref Category |
| `amountMinor` | BigInt | required |
| `currency` | String | required |
| `startDate` | Date | required |
| `endDate` | Date | required |
| `month` | Number |  |
| `year` | Number |  |
| `warnAtPercent` | Number |  |
| `status` | String | enum |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"month":1,"year":1}`, `{"userId":1,"status":1,"startDate":1}`

## Category (`categories`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | ref User, immutable |
| `name` | String | required |
| `kind` | String | required, enum |
| `isSystem` | Boolean |  |
| `icon` | String |  |
| `color` | String |  |
| `archivedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"kind":1,"name":1}` (unique)

## Debt (`debts`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `kind` | String | required, enum, immutable |
| `counterparty` | String | required |
| `currency` | String | required, immutable |
| `originalPrincipalMinor` | BigInt | required, immutable |
| `outstandingPrincipalMinor` | BigInt | required |
| `accruedInterestMinor` | BigInt | required |
| `interestRateBps` | Number |  |
| `interestMethod` | String | enum |
| `paymentFrequency` | String | enum |
| `startDate` | Date | required |
| `dueDate` | Date |  |
| `interestAccruedThrough` | Date |  |
| `status` | String | enum |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"status":1,"dueDate":1}`

## DebtPayment (`debtpayments`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `debtId` | ObjectId | required, ref Debt, immutable |
| `accountId` | ObjectId | ref Account |
| `date` | Date | required |
| `totalMinor` | BigInt | required, immutable |
| `principalMinor` | BigInt | required, immutable |
| `interestMinor` | BigInt | required, immutable |
| `currency` | String | required, immutable |
| `interestTransactionId` | ObjectId | ref Transaction |
| `idempotencyKey` | String |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"debtId":1,"date":-1}`, `{"userId":1,"idempotencyKey":1}` (unique)

## FinancialInsight (`financialinsights`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `ruleId` | String | required |
| `severity` | String | enum |
| `headline` | String | required |
| `what` | String | required |
| `period.from` | Date | required |
| `period.to` | Date | required |
| `calculation` | String | required |
| `why` | String | required |
| `dismissedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"ruleId":1,"period.from":1}` (unique), `{"userId":1,"createdAt":-1}`

## IdempotencyRecord (`idempotencyrecords`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `key` | String | required |
| `requestHash` | String | required |
| `status` | String | enum |
| `responseStatus` | Number |  |
| `responseBody` | Mixed |  |
| `expiresAt` | Date | required |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"key":1}` (unique), `{"expiresAt":1}`

## Notification (`notifications`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `type` | String | required, enum |
| `title` | String | required |
| `body` | String |  |
| `link` | String |  |
| `dedupeKey` | String |  |
| `readAt` | Date |  |
| `emailedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"readAt":1,"createdAt":-1}`, `{"userId":1,"dedupeKey":1}` (unique)

## Payment (`payments`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `planCode` | String |  |
| `amountMinor` | BigInt | required |
| `currency` | String | required |
| `status` | String | required, enum |
| `provider` | String | required |
| `providerPaymentId` | String | required |
| `paidAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"createdAt":-1}`, `{"provider":1,"providerPaymentId":1}` (unique)

## Profile (`profiles`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, unique, ref User, immutable |
| `displayName` | String |  |
| `country` | String |  |
| `currency` | String |  |
| `timezone` | String |  |
| `incomeRange` | String | enum |
| `occupation` | String | enum |
| `modes.student` | Boolean |  |
| `modes.youngProfessional` | Boolean |  |
| `goals` | Array |  |
| `planner.monthlyAllowanceMinor` | String |  |
| `planner.weeklyLimitMinor` | String |  |
| `planner.semesterStart` | Date |  |
| `planner.semesterEnd` | Date |  |
| `planner.semesterBudgetMinor` | String |  |
| `planner.monthlySalaryMinor` | String |  |
| `planner.emergencyTargetMonths` | Number |  |
| `theme` | String | enum |
| `hideBalances` | Boolean |  |
| `notificationPrefs.inApp` | Boolean |  |
| `notificationPrefs.email` | Boolean |  |
| `notificationPrefs.maskAmounts` | Boolean |  |
| `privacy.aiExplanationsConsent` | Boolean |  |
| `privacy.analyticsConsent` | Boolean |  |
| `onboardingCompletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1}` (unique)

## RecurringOccurrence (`recurringoccurrences`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `scheduleId` | ObjectId | required, ref RecurringTransaction, immutable |
| `occurrenceDate` | Date | required, immutable |
| `transactionId` | ObjectId | ref Transaction |
| `status` | String | enum |
| `error` | String |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"scheduleId":1,"occurrenceDate":1}` (unique)

## RecurringTransaction (`recurringtransactions`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `title` | String | required |
| `type` | String | required, enum |
| `amountMinor` | BigInt | required |
| `currency` | String | required |
| `accountId` | ObjectId | required, ref Account |
| `categoryId` | ObjectId | ref Category |
| `billId` | ObjectId | ref Bill |
| `subscriptionId` | ObjectId | ref Subscription |
| `recurrence.frequency` | String | required, enum |
| `recurrence.intervalDays` | Number |  |
| `recurrence.startDate` | Date | required |
| `recurrence.endDate` | Date |  |
| `recurrence.timezone` | String |  |
| `autoPost` | Boolean |  |
| `status` | String | enum |
| `lastGeneratedThrough` | Date |  |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"status":1}`

## SavingsContribution (`savingscontributions`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `goalId` | ObjectId | required, ref SavingsGoal, immutable |
| `accountId` | ObjectId | ref Account |
| `direction` | String | required, enum, immutable |
| `amountMinor` | BigInt | required, immutable |
| `currency` | String | required, immutable |
| `date` | Date | required |
| `note` | String |  |
| `idempotencyKey` | String |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"goalId":1,"date":-1}`, `{"userId":1,"idempotencyKey":1}` (unique)

## SavingsGoal (`savingsgoals`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `name` | String | required |
| `description` | String |  |
| `targetMinor` | BigInt | required |
| `currentMinor` | BigInt | required |
| `currency` | String | required |
| `targetDate` | Date |  |
| `imageAttachmentId` | ObjectId | ref Attachment |
| `linkedAccountId` | ObjectId | ref Account |
| `status` | String | enum |
| `completedAt` | Date |  |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"status":1}`

## Session (`sessions`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `tokenHash` | String | required, unique |
| `csrfHash` | String | required |
| `userAgent` | String |  |
| `ipPrefix` | String |  |
| `expiresAt` | Date | required |
| `absoluteExpiresAt` | Date | required |
| `lastSeenAt` | Date |  |
| `revokedAt` | Date |  |
| `rotatedFrom` | ObjectId | ref Session |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"tokenHash":1}` (unique), `{"userId":1,"revokedAt":1}`, `{"expiresAt":1}`

## Subscription (`subscriptions`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `name` | String | required |
| `provider` | String |  |
| `kind` | String | enum |
| `amountMinor` | BigInt | required |
| `currency` | String | required |
| `billingFrequency` | String | required, enum |
| `nextBillingDate` | Date | required |
| `paymentAccountId` | ObjectId | ref Account |
| `status` | String | enum |
| `cancelledAt` | Date |  |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"status":1,"nextBillingDate":1}`

## SubscriptionPlan (`subscriptionplans`)

| Path | Type | Notes |
|---|---|---|
| `code` | String | required, unique, enum |
| `name` | String | required |
| `priceMinor` | BigInt | required |
| `currency` | String | required |
| `interval` | String | enum |
| `trialDays` | Number |  |
| `providerPriceId` | String |  |
| `limits.accounts` | Number |  |
| `limits.budgets` | Number |  |
| `limits.savingsGoals` | Number |  |
| `limits.recurring` | Number |  |
| `limits.reportMonths` | Number |  |
| `features` | Array |  |
| `active` | Boolean |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"code":1}` (unique)

## Transaction (`transactions`)

| Path | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required, ref User, immutable |
| `accountId` | ObjectId | required, ref Account, immutable |
| `type` | String | required, enum, immutable |
| `direction` | String | enum |
| `status` | String | enum |
| `title` | String | required |
| `amountMinor` | BigInt | required |
| `currency` | String | required, immutable |
| `categoryId` | ObjectId | ref Category |
| `transactionDate` | Date | required |
| `description` | String |  |
| `notes` | String |  |
| `tags` | Array |  |
| `attachmentIds` | Array | ref Attachment |
| `transferGroupId` | String | immutable |
| `transferConversion.rate` | String |  |
| `transferConversion.fromCurrency` | String |  |
| `transferConversion.toCurrency` | String |  |
| `reversalOf` | ObjectId | ref Transaction, immutable |
| `reversedById` | ObjectId | ref Transaction |
| `refundOf` | ObjectId | ref Transaction, immutable |
| `debtId` | ObjectId | ref Debt |
| `billId` | ObjectId | ref Bill |
| `subscriptionId` | ObjectId | ref Subscription |
| `savingsGoalId` | ObjectId | ref SavingsGoal |
| `recurringOccurrenceId` | ObjectId | ref RecurringOccurrence |
| `idempotencyKey` | String | immutable |
| `postedAt` | Date |  |
| `deletedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"userId":1,"transactionDate":-1}`, `{"userId":1,"accountId":1,"transactionDate":-1}`, `{"userId":1,"type":1,"transactionDate":-1}`, `{"userId":1,"categoryId":1,"transactionDate":-1}`, `{"userId":1,"idempotencyKey":1}` (unique), `{"userId":1,"reversalOf":1}` (unique)

## User (`users`)

| Path | Type | Notes |
|---|---|---|
| `email` | String | required, unique |
| `passwordHash` | String | required |
| `role` | String | indexed, enum |
| `status` | String | enum |
| `emailVerifiedAt` | Date |  |
| `emailVerificationTokenHash` | String |  |
| `emailVerificationExpiresAt` | Date |  |
| `passwordResetTokenHash` | String |  |
| `passwordResetExpiresAt` | Date |  |
| `failedLoginCount` | Number |  |
| `lockedUntil` | Date |  |
| `lastLoginAt` | Date |  |
| `twoFactor.enabled` | Boolean |  |
| `twoFactor.secretEnvelope` | String |  |
| `twoFactor.lastStep` | Number |  |
| `twoFactor.recoveryCodeHashes` | Array |  |
| `deletionRequestedAt` | Date |  |
| `_id` | ObjectId |  |
| `createdAt` | Date | immutable |
| `updatedAt` | Date |  |
| `version` | Number |  |

Indexes: `{"email":1}` (unique), `{"role":1}`, `{"status":1,"createdAt":-1}`

