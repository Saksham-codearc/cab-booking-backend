import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { supabase } from '../lib/supabase.js';

export interface AuthedRequest extends Request {
  profile?: any;
}

export async function requireProfile(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });
    const { data, error } = await supabase.from('profiles').select('*').eq('clerk_user_id', userId).maybeSingle();
    if (error) return res.status(500).json({ success: false, message: 'Profile lookup failed' });
    if (!data) return res.status(403).json({ success: false, message: 'Please synchronize your profile first' });
    req.profile = data;
    next();
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Auth middleware error' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.profile) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (!roles.includes(req.profile.role)) return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    next();
  };
}
