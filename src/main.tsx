import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

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
import { Shoot } from './screens/Shoot'
import { TickOff } from './screens/TickOff'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Now /> },
      // Reachable without choosing a session type or a window: ticking off what
      // is already done must never require planning anything first.
      { path: 'tick-off', element: <TickOff /> },
      { path: 'shoot', element: <Shoot /> },
      { path: 'campaigns', element: <Campaigns /> },
      { path: 'campaigns/new', element: <NewCampaign /> },
      { path: 'campaigns/:campaignId', element: <Campaign /> },
      { path: 'money', element: <Money /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <RouterProvider router={router} />
    </DataProvider>
  </StrictMode>,
)
