import { Request, Response, NextFunction } from 'express';
 
// ── TEMPORARY MOCK ────────────────────────────────────────────────────
// This lets you develop and test without waiting for Dev 1.
// When Dev 1 finishes their subscription system, you will replace
// the 'mockUser' lines with a real API call to their endpoint.
// ─────────────────────────────────────────────────────────────────────
 
export const requireSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // ── MOCK: Pretend user is subscribed ───────────────────────────
    // Change isSubscribed to false to test the 'free user' locked state
    const mockUser = {
      isSubscribed: true,
      isAdminOverride: false,
      plan: 'LUMINARY',
    };
    // ── END MOCK ───────────────────────────────────────────────────
 
    if (mockUser.isSubscribed || mockUser.isAdminOverride) {
      // Attach user info to request so route handlers can use it
      (req as any).user = mockUser;
      return next();
    }
 
    // User is NOT subscribed — reject the request
    return res.status(403).json({
      success: false,
      error: 'This feature requires an active LUMINARY subscription.',
      upgradeUrl: '/pricing',
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Could not verify subscription status.',
    });
  }
};
