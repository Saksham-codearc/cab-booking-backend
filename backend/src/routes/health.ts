import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, message: 'Cab Booking API is running!', timestamp: new Date().toISOString() });
});

router.get('/db-health', async (_req, res) => {
  const { supabase } = await import('../lib/supabase.js');
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    if (error) {
      console.error('Database query failed:', error.message);
      return res.status(500).json({ success: false, message: 'Database query failed' });
    }
    return res.status(200).json({ success: true, message: 'Supabase connection successful' });
  } catch (error) {
    console.error('Database connection failed:', error);
    return res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

export default router;
