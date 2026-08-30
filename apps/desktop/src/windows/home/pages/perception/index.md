# windows/home/pages/perception/
The perception & privacy page: the Privacy Pause control, what is being sampled right now, and the coalesced activity
card. It surfaces ONLY what perception.* already exposes — retention/screenshot policy is knob material, so this page
points at the settings page instead of inventing a control.
- perception-page.tsx — page root: pause card, sampling + activity cards, retention knob pointer; loading rides Skeleton, the failed read carries a retry, and the pointer is the ActionButton link tone
- pause-controls.tsx — the Privacy Pause card: current wording + pause / 暂停到明天 / resume
- use-perception.ts — the page's ONLY ws touchpoint: perception.card / pauseGet / pauseSet; a successful replacement pause read clears stale transport error, while failed reads retain it. The card is MEMORY-ONLY and pause is never cached
- perception-view.ts — pure view models (pause wording, sampling + activity rows) + the local-midnight deadline
