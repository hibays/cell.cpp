// Animation helpers (GSAP). Kept in one module so the animation library can be
// swapped (anime.js / osmo) without touching the components.

import gsap from 'gsap'

/** Staggered entrance for landing text blocks. */
export function revealStagger(targets: string | Element[], delay = 0): void {
  gsap.from(targets, {
    y: 18,
    opacity: 0,
    duration: 0.7,
    ease: 'power3.out',
    stagger: 0.08,
    delay,
  })
}

/** A soft pulse used when a turn starts (draws the eye to the stream). */
export function pulse(element: Element): void {
  gsap.fromTo(
    element,
    { boxShadow: '0 0 0 0 rgba(59,130,246,0.35)' },
    { boxShadow: '0 0 0 14px rgba(59,130,246,0)', duration: 0.9, ease: 'power2.out' },
  )
}

/** Slide-in for a freshly appended chat message. */
export function slideIn(element: Element): void {
  gsap.from(element, { y: 10, opacity: 0, duration: 0.28, ease: 'power2.out' })
}

export { gsap }
