import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Clientes } from './pages/Clientes';
import { Autorizacoes } from './pages/Autorizacoes';
import { Duvidas } from './pages/Duvidas';
import { Metricas } from './pages/Metricas';
import { Historico } from './pages/Historico';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/autorizacoes" element={<Autorizacoes />} />
            <Route path="/duvidas" element={<Duvidas />} />
            <Route path="/metricas" element={<Metricas />} />
            <Route path="/historico" element={<Historico />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
