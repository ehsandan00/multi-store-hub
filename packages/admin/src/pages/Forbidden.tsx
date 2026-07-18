import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';

export function Forbidden() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <p className="text-5xl font-bold text-slate-300">{t('forbidden.code')}</p>
      <p className="text-lg font-semibold text-slate-900">{t('forbidden.title')}</p>
      <p className="max-w-sm text-sm text-slate-500">{t('forbidden.message')}</p>
      <Link to="/">
        <Button type="button">{t('forbidden.back')}</Button>
      </Link>
    </div>
  );
}
