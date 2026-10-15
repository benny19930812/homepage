---
title: 金流系統的冪等設計：怎麼防止重複扣款與重複入帳
date: 2026-10-15
description: 付款通知會重送、使用者會連點、服務會重試。整理在 Spring Boot 金流服務裡，從 API、訊息到資料庫三層做冪等的做法。
tags: [金流, 冪等, Spring Boot, RabbitMQ]
draft: false
---

金流系統最怕的兩件事：使用者被扣兩次錢，或是同一筆款項入帳兩次。這兩種錯誤的根源通常一樣——**同一個請求被處理了不只一次**。

在分散式系統裡，「只送一次」幾乎不可能保證：

- 使用者在付款頁連點兩下
- 前端逾時後自動重送
- 第三方金流的付款結果通知（callback）會重送，直到收到成功回應為止
- RabbitMQ 消費者處理到一半掛掉，訊息被重新投遞

所以比較實際的目標是：**讓同一個請求處理多次，結果和處理一次相同**。這就是冪等（idempotency）。

## 第一層：API 冪等鍵

建立訂單或發起付款的 API，請呼叫端帶一個冪等鍵（`Idempotency-Key`），同一個鍵只會真正執行一次。

```java
@PostMapping("/payments")
public PaymentResponse create(
        @RequestHeader("Idempotency-Key") String key,
        @RequestBody PaymentRequest req) {

    String lockKey = "idem:payment:" + key;
    Boolean first = redis.opsForValue()
            .setIfAbsent(lockKey, "PROCESSING", Duration.ofHours(24));

    if (Boolean.FALSE.equals(first)) {
        // 同一個鍵已經處理過或正在處理，回傳先前的結果
        return paymentService.findByIdempotencyKey(key)
                .orElseThrow(() -> new ConflictException("請求處理中，請稍後再查詢"));
    }
    return paymentService.create(key, req);
}
```

Redis 的 `SETNX` 擋住大部分的重複請求，但它只是第一道防線。Redis 重啟或鍵過期後，還是可能放行重複請求，所以資料庫也要有保護。

## 第二層：資料庫唯一約束

真正保證不重複的，是資料庫的唯一約束：

```sql
ALTER TABLE payment_order
  ADD UNIQUE KEY uk_idempotency_key (idempotency_key);

ALTER TABLE ledger_entry
  ADD UNIQUE KEY uk_order_type (order_no, entry_type);
```

入帳時直接寫入，撞到唯一約束就代表已經入帳過：

```java
try {
    ledgerRepository.insert(entry);
} catch (DuplicateKeyException e) {
    log.info("訂單 {} 已入帳，略過", entry.getOrderNo());
}
```

這比「先查詢有沒有入帳，沒有再寫入」可靠。先查後寫在高併發下會有競態條件：兩個執行緒同時查到「沒有」，就會各寫一筆。

## 第三層：狀態機只允許往前走

訂單狀態用條件更新，只有在預期的前一個狀態才能轉換：

```sql
UPDATE payment_order
   SET status = 'SUCCESS', paid_at = NOW()
 WHERE order_no = ?
   AND status = 'PAYING';
```

影響筆數是 `1` 才代表這次是真正的狀態轉換，接著才做入帳、發通知；是 `0` 就代表已經被處理過（或狀態不對），直接回應成功即可。

| 目前狀態 | 收到「付款成功」通知 | 結果 |
|---|---|---|
| `PAYING` | 更新為 `SUCCESS`，觸發入帳 | 正常處理 |
| `SUCCESS` | 影響 0 筆 | 視為重送，直接回 200 |
| `FAILED` | 影響 0 筆 | 記錄異常，交給對帳處理 |

## 訊息消費端也要冪等

RabbitMQ 是「至少送達一次」，消費者一定會遇到重複訊息。做法和上面一樣：用訊息裡的業務鍵（例如訂單編號）搭配狀態機或唯一約束判斷，而不是依賴 RabbitMQ 的 message id。

處理完成後才 `ack`；處理失敗就丟到重試佇列，超過次數進死信佇列，由補單流程接手。

## 最後一道網：對帳

再嚴謹的設計都可能有漏網之魚，所以每天定時跟金流商的對帳檔比對：

- 金流商有、我們沒有 → 補單
- 我們成功、金流商失敗 → 標記異常，人工確認
- 金額不一致 → 告警

冪等讓系統在大部分情況下自己處理好重複，對帳負責抓出剩下的例外，兩者加起來才能確保最終一致。

## 小結

- **API 層**：冪等鍵 + Redis 擋掉大部分重複請求
- **資料層**：唯一約束是最後的保證，不要只靠先查後寫
- **狀態層**：條件更新，狀態只能往前走
- **訊息層**：消費者用業務鍵判斷，處理完才 ack
- **對帳**：抓出所有漏掉的例外
