export default function RootLoading() {
  return (
    <div
      className="min-h-screen bg-[var(--bg-depth)]"
      aria-busy="true"
      aria-label="Loading"
    >
      {/* Header skeleton */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-transparent pt-[env(safe-area-inset-top,0px)]">
        <div className="w-full container-padding">
          <div className="flex items-center justify-between h-16 md:h-20">
            <div className="h-6 md:h-8 w-32 md:w-40 rounded bg-[var(--stone-dark)] animate-pulse" />
            <nav className="hidden md:flex items-center gap-8">
              <div className="h-4 w-12 rounded bg-[var(--stone-dark)] animate-pulse" />
              <div className="h-4 w-12 rounded bg-[var(--stone-dark)] animate-pulse" />
              <div className="h-9 w-24 rounded bg-[var(--stone-dark)] animate-pulse" />
            </nav>
          </div>
        </div>
      </header>

      {/* Main content skeleton */}
      <main id="main-content" className="relative z-10 pt-16 md:pt-20">
        <div className="section-bleed section-fade-in">
          <div className="container-padding py-12 md:py-20">
            {/* Hero skeleton */}
            <div className="max-w-4xl mx-auto text-center space-y-6">
              <div className="h-12 md:h-16 w-3/4 mx-auto rounded bg-[var(--stone-dark)] animate-pulse" />
              <div className="h-4 w-full max-w-xl mx-auto rounded bg-[var(--stone-dark)] animate-pulse opacity-80" />
              <div className="h-4 w-2/3 mx-auto rounded bg-[var(--stone-dark)] animate-pulse opacity-60" />
              <div className="flex justify-center gap-4 pt-4">
                <div className="h-11 w-32 rounded bg-[var(--stone-dark)] animate-pulse" />
                <div className="h-11 w-28 rounded bg-[var(--stone-dark)] animate-pulse" />
              </div>
            </div>

            {/* Features skeleton */}
            <div className="mt-16 md:mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card-premium p-6 rounded-lg">
                  <div className="h-40 rounded bg-[var(--stone-dark)] animate-pulse mb-4" />
                  <div className="h-5 w-3/4 rounded bg-[var(--stone-dark)] animate-pulse mb-2" />
                  <div className="h-3 w-full rounded bg-[var(--stone-dark)] animate-pulse opacity-70" />
                  <div className="h-3 w-2/3 rounded bg-[var(--stone-dark)] animate-pulse opacity-50 mt-2" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
