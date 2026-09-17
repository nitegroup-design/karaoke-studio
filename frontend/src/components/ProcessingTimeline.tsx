

type Step = 'upload' | 'separating' | 'transcribing' | 'done' | 'error';

interface ProcessingTimelineProps {
  currentStep: Step;
}

const steps = [
  { id: 'upload', label: 'Upload' },
  { id: 'separating', label: 'Tách nhạc' },
  { id: 'transcribing', label: 'Nhận diện lyrics' },
  { id: 'done', label: 'Hoàn thành' }
];

export function ProcessingTimeline({ currentStep }: ProcessingTimelineProps) {
  const getStepIndex = (step: Step) => {
    if (step === 'error') return -1;
    return steps.findIndex(s => s.id === step);
  };

  const currentIndex = getStepIndex(currentStep);

  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-between relative">
        {/* Progress Line */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full z-0"></div>
        <div 
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-gradient-primary rounded-full z-0 transition-all duration-700 ease-in-out"
          style={{ width: `${currentIndex >= 0 ? (currentIndex / (steps.length - 1)) * 100 : 0}%` }}
        ></div>

        {/* Steps */}
        {steps.map((step, index) => {
          const isPast = currentIndex > index;
          const isActive = currentIndex === index;
          const isFuture = currentIndex < index;
          
          return (
            <div key={step.id} className="relative z-10 flex flex-col items-center group">
              <div 
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 shadow-lg ${
                  isPast 
                    ? 'bg-gradient-primary text-white scale-100' 
                    : isActive 
                      ? 'bg-white dark:bg-gray-800 border-2 border-amber-500 text-amber-500 scale-110 animate-pulse-glow'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 scale-100'
                }`}
              >
                {isPast && (
                  <svg className="w-5 h-5 animate-slide-up" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isActive && step.id === 'upload' && (
                  <svg className="w-5 h-5 animate-float" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
                {isActive && step.id === 'separating' && (
                  <div className="flex gap-1 items-center h-4">
                    <div className="w-1 bg-amber-500 h-2 animate-wave" style={{ animationDelay: '0s' }}></div>
                    <div className="w-1 bg-amber-500 h-4 animate-wave" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 bg-amber-500 h-2 animate-wave" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                )}
                {isActive && step.id === 'transcribing' && (
                  <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                )}
                {isActive && step.id === 'done' && (
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isFuture && (
                  <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500"></div>
                )}
              </div>
              <div className={`mt-3 text-sm font-medium transition-colors duration-300 ${
                isPast || isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'
              }`}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
