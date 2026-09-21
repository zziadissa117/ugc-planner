import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import { App } from './App'
import { DataProvider } from './data/DataProvider'
import './index.css'
import { Campaign } from './screens/Campaign'
import { Campaigns } from './screens/Campaigns'
import { Money } from './screens/Money'
import { NewCampaign } from './screens/NewCampaign'
import { NotFound } from './screens/NotFound'
import { Now } from './screens/Now'
import { Settings } from './screens/Settings'
import { Posting } from './screens/Posting'
import { UpdateCampaign } from './screens/UpdateCampaign'
import { AuthProvider } from './sync'

// Keeping an open copy up to date.
//
// The service worker already activates a new version the moment it is
// installed, but nothing told a page that was already open to pick it up, and
// nothing even looked for one: a browser only checks for a new service worker
// when a page is loaded. On a laptop the app sits in a tab for days, so it kept
// running whatever build it was opened with - "you did not do anything that I
// said" was a tab running the version from before the change. `autoUpdate`
// reloads the page when a new version takes over; this makes it look for one
// every minute and whenever he comes back to the tab.
registerSW({
  immediate: true,
  onRegistered(registration) {
    if (!registration) return
    const check = () => {
      // Offline, or the server unreachable: nothing to update to right now.
      registration.update().catch(() => undefined)
    }
    window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

// The planner, the teleprompter and the separate tick-off list are gone. All
// three existed to answer "what should tonight look like" - a question he
// never asked the app; he asked it for a target, a scoreboard and a way to
// record what actually went out. Posting lives at /post and nowhere else, so
// there is exactly one place that can say a thing was posted.
const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Now /> },
      { path: 'post', element: <Posting /> },
      { path: 'campaigns', element: <Campaigns /> },
      { path: 'campaigns/new', element: <NewCampaign /> },
      { path: 'campaigns/:campaignId', element: <Campaign /> },
      { path: 'campaigns/:campaignId/update', element: <UpdateCampaign /> },
      { path: 'money', element: <Money /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </DataProvider>
  </StrictMode>,
)
