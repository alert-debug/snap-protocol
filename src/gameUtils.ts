import CryptoJS from 'crypto-js';
import { shuffle } from 'lodash';

export type Card = {
  suit: string;
  value: string;
};

export const SUITS = ['♠', '♣', '♥', '♦'];
export const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

// Simple seeded random number generator
export function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ h >>> 16, 0x85ebca6b);
    h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function shuffleDeck(deck: Card[], seed: string): Card[] {
  const rng = seededRandom(seed);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function generateCommitment() {
  const seed = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const hash = CryptoJS.SHA256(seed).toString();
  return { seed, hash };
}
