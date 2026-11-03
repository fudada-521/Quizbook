import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gaoxiang.quiz',
  appName: '高项千题闯关',
  webDir: '../web/dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
