import { useState } from "react"
import { motion } from "motion/react"
import { ApplicationIcon } from "@/components/application-icon"
import { Badge } from "@/components/ui/badge"
import type { ApplicationSummary } from "@/types"

const BASE_WIDTH = 321
const BASE_HEIGHT = 270
const SCALE = 0.34

const FLAP_PATH = "M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z"

const folderThemes = {
  light: {
    back: "#171717",
    backShadow: "inset 0 0 6px 2px rgba(255,255,255,0.30)",
    flap: "#292929",
    flapStroke: "#696969",
  },
  dark: {
    back: "#f5f5f4",
    backShadow: "inset 0 0 6px 2px rgba(23,23,23,0.18)",
    flap: "#e8e7e3",
    flapStroke: "#c8c6c0",
  },
} as const

interface ProjectFolderProps {
  projectId: string
  applications: ApplicationSummary[]
  dark?: boolean
}

export function ProjectFolder({ projectId, applications, dark = false }: ProjectFolderProps) {
  const [hovered, setHovered] = useState(false)
  const theme = dark ? folderThemes.dark : folderThemes.light
  const visible = applications.slice(0, 6)
  const center = (visible.length - 1) / 2

  return (
    <div
      data-project-folder
      className="relative shrink-0"
      style={{ width: BASE_WIDTH * SCALE, height: BASE_HEIGHT * SCALE }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${SCALE})`,
          perspective: 800,
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: BASE_WIDTH,
            height: BASE_HEIGHT,
            borderRadius: 25,
            backgroundColor: theme.back,
            boxShadow: theme.backShadow,
          }}
        />

        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          {visible.map((application, index) => {
            const offset = index - center
            return (
              <motion.div
                key={application.name}
                data-project-folder-app
                className="absolute"
                animate={hovered ? {
                  x: offset * 48,
                  y: -62 - (center - Math.abs(offset)) * 10,
                  rotate: offset * 5,
                  scale: 1.18,
                } : {
                  x: offset * 44,
                  y: -34 - (center - Math.abs(offset)) * 4,
                  rotate: offset * 2,
                  scale: 1,
                }}
                transition={{ type: "spring", stiffness: 125, damping: 15, delay: index * 0.035 }}
              >
                <ApplicationIcon projectId={projectId} name={application.name} asset={application.iconAsset} size="xl" variant="adaptive" />
              </motion.div>
            )
          })}
        </div>

        <motion.div
          className="absolute left-1/2 top-1/2 mt-4 -translate-x-1/2 -translate-y-1/2"
          style={{ transformOrigin: "bottom center", transformStyle: "preserve-3d", width: 321, height: 241 }}
          animate={{ rotateX: hovered ? -43 : -15 }}
          transition={{ type: "spring", stiffness: 125, damping: 15 }}
        >
          <svg className="absolute inset-0" width="321" height="241" viewBox="0 0 321 241" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d={FLAP_PATH} fill={theme.flap} fillOpacity="0.88" stroke={theme.flapStroke} />
          </svg>
        </motion.div>
      </div>

      {applications.length > visible.length && (
        <Badge variant="secondary" className="absolute -right-3 -top-1 h-4 min-w-4 rounded-full px-1 text-[9px]">+{applications.length - visible.length}</Badge>
      )}
    </div>
  )
}
