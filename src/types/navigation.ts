export type RootStackParamList = { CreatorStudio: undefined; VideoBattle: { clipId: string } };
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
