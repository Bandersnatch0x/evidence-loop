// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoleGate } from '../src/components/RoleGate'
import {
  isStudentRole,
  isTeacherRole
} from '../src/components/rolePredicates'

describe('RoleGate', () => {
  it('renders children when role is allowed', () => {
    render(
      <RoleGate role="student" allow={['student']} deniedMessage="denied">
        <span>ok-content</span>
      </RoleGate>
    )
    expect(screen.getByText('ok-content')).toBeTruthy()
    expect(screen.queryByText('denied')).toBeNull()
  })

  it('renders denied message when role is blocked', () => {
    render(
      <RoleGate
        role="student"
        allow={['teacher', 'admin']}
        deniedMessage="仅教师可访问"
      >
        <span>secret</span>
      </RoleGate>
    )
    expect(screen.queryByText('secret')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('仅教师可访问')
  })

  it('allows all roles when allow is omitted', () => {
    render(
      <RoleGate role="admin" deniedMessage="denied">
        <span>open</span>
      </RoleGate>
    )
    expect(screen.getByText('open')).toBeTruthy()
  })

  it('exposes role predicates', () => {
    expect(isStudentRole('student')).toBe(true)
    expect(isStudentRole('teacher')).toBe(false)
    expect(isTeacherRole('teacher')).toBe(true)
    expect(isTeacherRole('admin')).toBe(true)
    expect(isTeacherRole('student')).toBe(false)
  })
})
