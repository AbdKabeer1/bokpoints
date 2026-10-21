# @bokpoints/web — stub

Store dashboard, Cashier screen and admin panel. One React + Vite app,
installable as a PWA (service worker + IndexedDB for the offline queue).

Not implemented yet. It is build-order step 4 in `AGENT.md` section 13:
the Cashier screen, online flow only, with the confirm step.

The Cashier screen is the highest-risk surface in the product, so it is
built against the shared points engine in `@bokpoints/shared` so the
offline till and the server cannot disagree about a balance.
