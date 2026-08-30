import React, { useEffect, useState } from 'react';

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking backend status...');
  const [healthData, setHealthData] = useState(null);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  useEffect(() => {
    fetch(`${apiUrl}/api/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setApiStatus('Connected (OK)');
        setHealthData(data);
      })
      .catch((err) => {
        setApiStatus(`Backend unreachable (${err.message})`);
      });
  }, [apiUrl]);

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>NEXUS Deployment Test</h1>
      <p style={{ color: '#666' }}>Controlled full-stack deployment verification fixture.</p>

      <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px', background: '#fafafa' }}>
        <h3>Backend Integration</h3>
        <p><strong>Target API:</strong> {apiUrl}</p>
        <p><strong>Status:</strong> {apiStatus}</p>
        {healthData && (
          <pre style={{ background: '#eee', padding: '0.5rem', borderRadius: '4px', fontSize: '12px' }}>
            {JSON.stringify(healthData, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
