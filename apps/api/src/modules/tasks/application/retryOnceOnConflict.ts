import { isAppError } from '../../../shared/errors';

export const retryOnceOnConflict = async <T>(attempt: () => Promise<T>): Promise<T> => {
  try {
    return await attempt();
  } catch (error) {
    if (isAppError(error) && error.code === 'CONFLICT') return attempt();
    throw error;
  }
};
