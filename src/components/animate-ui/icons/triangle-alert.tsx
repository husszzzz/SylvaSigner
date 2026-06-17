'use client'

import * as React from 'react'
import { motion, type Variants } from 'motion/react'

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon'

type TriangleAlertProps = IconProps<keyof typeof animations>

const animations = {
  default: {
    triangle: {
      initial: {
        scale: 1,
      },
      animate: {
        scale: [1, 1.05, 1],
        transition: {
          duration: 0.8,
          ease: 'easeInOut',
        },
      },
    },
    line: {
      initial: {
        y: 0,
        opacity: 1,
      },
      animate: {
        y: [0, -1.5, 0],
        opacity: [1, 0.7, 1],
        transition: {
          duration: 0.8,
          ease: 'easeInOut',
        },
      },
    },
    dot: {
      initial: {
        scale: 1,
        opacity: 1,
      },
      animate: {
        scale: [1, 1.35, 1],
        opacity: [1, 0.65, 1],
        transition: {
          duration: 0.8,
          ease: 'easeInOut',
        },
      },
    },
  } satisfies Record<string, Variants>,
} as const

function IconComponent({ size, ...props }: TriangleAlertProps) {
  const { controls } = useAnimateIconContext()
  const variants = getVariants(animations)

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.path
        d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
        variants={variants.triangle}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M12 9v4"
        variants={variants.line}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M12 17h.01"
        variants={variants.dot}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  )
}

function TriangleAlert(props: TriangleAlertProps) {
  return <IconWrapper icon={IconComponent} {...props} />
}

export {
  animations,
  TriangleAlert,
  TriangleAlert as TriangleAlertIcon,
  type TriangleAlertProps,
  type TriangleAlertProps as TriangleAlertIconProps,
}
