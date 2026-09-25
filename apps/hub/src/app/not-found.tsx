import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Такой игры нет</h1>
      <p className="text-muted-foreground">
        <Link href="/" className="underline">
          Вернуться в каталог
        </Link>
      </p>
    </section>
  );
}
