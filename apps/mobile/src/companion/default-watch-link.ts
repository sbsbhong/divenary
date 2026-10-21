import { createNativeWatchLink, resolveNativeWatchLinkModule } from './native-watch-link';
import type { WatchLink } from './watch-link';

/** The app-wide link to this phone's companion watch, or a no-op link when there is none. */
export const defaultWatchLink: WatchLink = createNativeWatchLink(resolveNativeWatchLinkModule());
