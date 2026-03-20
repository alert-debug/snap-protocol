# Snap Protocol: Fair P2P Card Gaming

This document explains the underlying protocol used in the **Snap Protocol** application to ensure fair play in a peer-to-peer (P2P) environment without a central server.

## 1. The Fair Deck Protocol (Mental Poker)

In a traditional server-client game, the server shuffles the deck and tells the players what they see. In a P2P game, if one player shuffles, they could easily cheat. To prevent this, we use a **Commitment-Reveal** scheme.

### Phase A: Commitment
1. Each player generates a high-entropy random string (the `seed`).
2. Each player calculates the SHA-256 `hash` of their seed.
3. Players exchange only the `hash` values. 
   * *Security Benefit:* This "locks in" each player's contribution to the deck's randomness without revealing it to the opponent.

### Phase B: Reveal
1. Once both players have received a hash, they exchange their actual `seed` values.
2. Each player verifies that the received `seed` matches the `hash` provided in Phase A.
   * *Security Benefit:* This ensures neither player could change their seed after seeing the opponent's seed.

### Phase C: Deterministic Shuffling
1. Both players combine the seeds (e.g., `sort(seedA, seedB).join('-')`).
2. They use this combined string as a seed for a **Deterministic Random Number Generator (DRNG)**.
3. They perform a Fisher-Yates shuffle on a standard 52-card deck using this DRNG.
   * *Result:* Both players arrive at the exact same deck order without ever needing a central authority.

---

## 2. Real-Time Gameplay Protocol

Once the deck is generated, the game enters the `PLAYING` state. Communication happens via PeerJS DataConnections.

### Message Types
* `PLAY_CARD`: Sent when a player deals a card to the center.
* `SNAP`: Sent when a player claims the center pile.
* `GAME_OVER`: Sent when a player claims victory (opponent's deck is empty).

---

## 3. Security Gaps & "Rogue Client" Vulnerabilities

As a "toy" implementation, there are several areas where a malicious (rogue) client could currently exploit the protocol. These are left as exercises for students to solve:

### Gap 1: Card Spoofing (Integrity)
**The Issue:** The `PLAY_CARD` message includes the `card` object. The receiving client currently trusts this object and adds it to the center pile.
**The Rogue Move:** A player could send a `PLAY_CARD` message with an "Ace of Spades" even if their next deterministic card was a "2 of Hearts".
**The Fix:** Since both clients know the initial deck and the seed, the receiver should verify that the played card matches the expected next card in the opponent's deterministic sequence.

### Gap 2: State Desync & Snap Cheating
**The Issue:** `SNAP` messages are processed based on the receiver's current `centerPile` state. 
**The Rogue Move:** A player could send a `SNAP` message even if there isn't a match. If the receiver's state is lagging and *does* show a match from a previous turn, they might incorrectly grant the pile.
**The Fix:** Include the IDs or values of the two matching cards in the `SNAP` message. The receiver should only accept the snap if their history shows those two cards were indeed the top two at some point.

### Gap 3: Pile Size Validation
**The Issue:** The game trusts the `GAME_OVER` message.
**The Rogue Move:** A player could send `GAME_OVER` immediately to win the game, regardless of the actual card counts.
**The Fix:** Clients should maintain a "Shadow State" of their opponent's deck count. A `GAME_OVER` message should only be accepted if the local shadow state confirms the opponent has 0 cards.

### Gap 4: Timestamp Manipulation
**The Issue:** We use `Date.now()` for snaps, but clocks aren't synchronized.
**The Rogue Move:** A player could manually backdate a snap message to "win" a race condition.
**The Fix:** Implement a basic clock synchronization (like NTP) or use a logical clock (Lamport timestamps) to order events.

---

## Conclusion
The **Snap Protocol** successfully solves the "Fair Shuffle" problem using cryptography, but it currently relies on "Optimistic Trust" during live gameplay. Hardening this protocol would involve moving to a "Zero Trust" model where every peer message is cryptographically or logically verified against the shared initial state.
