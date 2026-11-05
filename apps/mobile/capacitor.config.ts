import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.megrez.quiz',
  appName: '天权',
  webDir: '../web/dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
