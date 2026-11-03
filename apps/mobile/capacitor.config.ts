import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gaoxiang.quiz',
  appName: '知题',
  webDir: '../web/dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
