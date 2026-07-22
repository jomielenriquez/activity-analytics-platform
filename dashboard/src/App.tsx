import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DevicesPage } from './pages/DevicesPage';
import { TimelinePage } from './pages/TimelinePage';
import { StatsPage } from './pages/StatsPage';
import { RecentActivityPage } from './pages/RecentActivityPage';
import './App.css';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DevicesPage />} />
        <Route path="/devices/:id/timeline" element={<TimelinePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/activity/recent" element={<RecentActivityPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
