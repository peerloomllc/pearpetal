import { Redirect } from 'expo-router'

// Any unmatched route - including the https invite paths /petal/link and
// /petal/join (whose full path expo-router cannot map to a file route) -
// redirects to the shell, where app/index.tsx's Linking listeners parse the
// invite from the URL. Without this, expo-router shows an "Unmatched Route" page.
export default function NotFound () {
  return <Redirect href='/' />
}
