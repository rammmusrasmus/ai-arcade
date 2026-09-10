import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="card p-10 text-center flex flex-col items-center gap-3">
      <p className="text-5xl">🕹️</p>
      <h1 className="text-xl font-bold">Page not found</h1>
      <Link to="/" className="btn btn-primary">
        Back to the store
      </Link>
    </div>
  );
}
