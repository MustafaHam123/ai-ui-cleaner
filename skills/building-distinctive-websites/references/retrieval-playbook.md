# Reference retrieval playbook

## Decompose the need

Search for roles, not merely visual similarity:

- **Composition:** page-level hierarchy, rhythm, navigation, and section order.
- **Interaction:** filtering, editing, onboarding, comparison, feedback, and state transitions.
- **Component:** a specific table, gallery, navigation treatment, form, chart, or control.
- **Expression:** typography, color behavior, media treatment, density, and motion character.

One reference should not control every role. Prefer three to six complementary references over a large mood board.

## Query construction

Include the user goal and important constraints:

```text
Dense fintech operations dashboard for expert daily users; dark but readable;
fast transaction comparison; persistent filters; visible risk exceptions;
React and Tailwind; avoid decorative glass cards.
```

Use metadata filters only when they represent actual requirements. A strict industry filter can hide useful patterns from adjacent domains.

## Source roles

- Code-focused sources such as 21st.dev or CodePen are useful for implementation techniques only when the exact asset has a compatible license and curator review.
- Dribbble and gallery sources are useful for visual hypotheses, not proof that a design works in production.
- Figma sources are useful for component relationships, tokens, variants, and responsive intent when access permits.
- Product galleries such as recent.design and SaaS collections are useful for page structure and category conventions.
- Previously shipped and evaluated internal work is the strongest source for known constraints and outcomes.

Never treat likes, recency, or popularity as evidence of usability.

## Synthesis

For each selected record, note:

| Role | Adopt | Transform | Avoid |
|---|---|---|---|
| Composition | Underlying hierarchy or pacing | Fit to the user's content and brand | Exact section order or distinctive silhouette |
| Interaction | Proven state model or feedback pattern | Match the target workflow | Decorative interactions without task value |
| Expression | General typographic or spatial character | Rebuild with project tokens | Source fonts, colors, imagery, or branding by default |

If selected references conflict, resolve the conflict using the target audience and primary task rather than mixing both approaches.
