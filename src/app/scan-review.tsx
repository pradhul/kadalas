import { Redirect } from 'expo-router';

/** Legacy stack route — review lives inside the authenticated tab shell. */
export default function ScanReviewRedirect() {
  return <Redirect href="/(tabs)/review" />;
}
