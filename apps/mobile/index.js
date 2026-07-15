/**
 * @format
 */

import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import './global.css';
import App from './src/App';
import { registerWatchSyncNotificationBackgroundHandler } from './src/notifications/watch-sync-notification-service';
import { name as appName } from './app.json';

registerWatchSyncNotificationBackgroundHandler();
AppRegistry.registerComponent(appName, () => App);
