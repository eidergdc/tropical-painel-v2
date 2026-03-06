import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import {
  collection,
  doc,
  setDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore'
import toast from 'react-hot-toast'
import { auth, db } from '../firebase'
import { updateServerAndPropagateToDevices, buildListUrl } from '../lib/updateServerAndDevices'

const tabDevices = 'devices'
const tabLists = 'lists'

function formatDate(timestamp) {
  if (!timestamp?.toDate) return '-'
  return timestamp.toDate().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function toDateInputValue(timestamp) {
  if (!timestamp?.toDate) return ''
  const date = timestamp.toDate()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addMonthsToDate(baseDate, monthsToAdd) {
  const source = new Date(baseDate)
  const day = source.getDate()
  const year = source.getFullYear()
  const month = source.getMonth()

  const targetMonthDate = new Date(year, month + monthsToAdd, 1)
  const lastDayOfTargetMonth = new Date(
    targetMonthDate.getFullYear(),
    targetMonthDate.getMonth() + 1,
    0
  ).getDate()

  targetMonthDate.setDate(Math.min(day, lastDayOfTargetMonth))
  targetMonthDate.setHours(0, 0, 0, 0)
  return targetMonthDate
}

export default function Dashboard() {
  const [tab, setTab] = useState(tabDevices)
  const [devices, setDevices] = useState([])
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Device form
  const [editingDevice, setEditingDevice] = useState(null)
  const [deviceForm, setDeviceForm] = useState({
    userNumber: '',
    paymentStatus: false,
    expiresAt: '',
    expiryUpdateMode: 'keep',
    expiryMonths: '1',
    lists: [],
  })
  const [savingDevice, setSavingDevice] = useState(false)

  // Server form (Configurações)
  const [editingServer, setEditingServer] = useState(null)
  const [serverForm, setServerForm] = useState({
    name: '',
    dns: '',
    complement: '',
  })
  const [savingServer, setSavingServer] = useState(false)

  const user = auth.currentUser

  useEffect(() => {
    loadDevices()
    loadServers()
  }, [])

  async function loadDevices() {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'devices'))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? 0
        const tb = b.createdAt?.toDate?.()?.getTime() ?? 0
        return tb - ta
      })
      setDevices(list)
    } catch (e) {
      toast.error('Erro ao carregar dispositivos')
    } finally {
      setLoading(false)
    }
  }

  async function loadServers() {
    try {
      const snap = await getDocs(collection(db, 'servers'))
      setServers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch (e) {
      toast.error('Erro ao carregar servidores')
    }
  }

  const filteredDevices = devices.filter(
    (d) =>
      String(d.userNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.lists || []).some((l) =>
        String(l.name || '').toLowerCase().includes(search.toLowerCase())
      )
  )

  async function handleLogout() {
    await signOut(auth)
  }

  // ---- Device handlers ----
  function openEditDevice(device) {
    setEditingDevice(device)
    setDeviceForm({
      userNumber: device.userNumber || '',
      paymentStatus: device.paymentStatus ?? false,
      expiresAt: toDateInputValue(device.expiresAt),
      expiryUpdateMode: 'keep',
      expiryMonths: '1',
      lists: (device.lists || []).map((l) => ({ ...l })),
    })
  }

  function clearDeviceForm() {
    setEditingDevice(null)
    setDeviceForm({
      userNumber: '',
      paymentStatus: false,
      expiresAt: '',
      expiryUpdateMode: 'keep',
      expiryMonths: '1',
      lists: [],
    })
  }

  async function saveDevice(e) {
    e.preventDefault()
    setSavingDevice(true)
    try {
      const listsWithUrl = await Promise.all(
        (deviceForm.lists || []).map(async (item) => {
          const server = servers.find((s) => s.id === item.serverId)
          const dns = server?.dns || ''
          const complement = server?.complement || ''
          const url = buildListUrl(
            dns,
            complement,
            item.username || '',
            item.password || ''
          )
          return {
            ...item,
            name: server?.name || item.name,
            url,
          }
        })
      )

      const payload = {
        userNumber: deviceForm.userNumber,
        paymentStatus: !!deviceForm.paymentStatus,
        lists: listsWithUrl,
        updatedAt: serverTimestamp(),
      }

      if (editingDevice) {
        if (deviceForm.expiryUpdateMode === 'manual') {
          if (!deviceForm.expiresAt) {
            toast.error('Informe a data de vencimento manualmente.')
            setSavingDevice(false)
            return
          }
          payload.expiresAt = Timestamp.fromDate(
            new Date(`${deviceForm.expiresAt}T00:00:00`)
          )
        } else if (deviceForm.expiryUpdateMode === 'months') {
          const currentExpiresAt = editingDevice.expiresAt?.toDate?.() || new Date()
          const monthsToAdd = Number(deviceForm.expiryMonths || '1')
          const nextExpiresAt = addMonthsToDate(currentExpiresAt, monthsToAdd)
          payload.expiresAt = Timestamp.fromDate(nextExpiresAt)
        }
        await updateDoc(doc(db, 'devices', editingDevice.id), payload)
        toast.success('Dispositivo atualizado')
      } else {
        const userNumber = String(deviceForm.userNumber || '').trim()
        if (!userNumber) {
          toast.error('Informe o número do usuário.')
          setSavingDevice(false)
          return
        }
        payload.createdAt = serverTimestamp()
        payload.expiresAt = serverTimestamp()
        await setDoc(doc(db, 'devices', userNumber), payload)
        toast.success('Dispositivo adicionado')
      }
      clearDeviceForm()
      loadDevices()
    } catch (err) {
      console.error('Erro ao salvar dispositivo:', err)
      toast.error(err.message || 'Erro ao salvar dispositivo')
    } finally {
      setSavingDevice(false)
    }
  }

  async function deleteDevice(id) {
    if (!confirm('Excluir este dispositivo?')) return
    try {
      await deleteDoc(doc(db, 'devices', id))
      toast.success('Dispositivo excluído')
      loadDevices()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  async function setPaymentStatus(deviceId, paid) {
    try {
      await updateDoc(doc(db, 'devices', deviceId), {
        paymentStatus: !!paid,
        updatedAt: serverTimestamp(),
      })
      setDevices((prev) =>
        prev.map((d) =>
          d.id === deviceId ? { ...d, paymentStatus: !!paid } : d
        )
      )
      toast.success(paid ? 'Marcado como pago' : 'Marcado como pendente')
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  // ---- Server (Configurações) handlers ----
  function openEditServer(server) {
    setEditingServer(server)
    setServerForm({
      name: server.name || '',
      dns: server.dns || '',
      complement: server.complement || '',
    })
  }

  function clearServerForm() {
    setEditingServer(null)
    setServerForm({ name: '', dns: '', complement: '' })
  }

  async function saveServer(e) {
    e.preventDefault()
    setSavingServer(true)
    try {
      if (editingServer) {
        await updateServerAndPropagateToDevices(editingServer.id, {
          name: serverForm.name,
          dns: serverForm.dns,
          complement: serverForm.complement,
        })
        toast.success(
          'Servidor atualizado. As URLs foram atualizadas em todos os dispositivos que usam este servidor.'
        )
      } else {
        await addDoc(collection(db, 'servers'), {
          name: serverForm.name,
          dns: serverForm.dns,
          complement: serverForm.complement,
          createdAt: serverTimestamp(),
        })
        toast.success('Servidor adicionado')
      }
      clearServerForm()
      loadServers()
      loadDevices()
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar servidor')
    } finally {
      setSavingServer(false)
    }
  }

  async function deleteServer(server) {
    if (!confirm(`Excluir o servidor "${server.name}"?`)) return
    try {
      await deleteDoc(doc(db, 'servers', server.id))
      toast.success('Servidor excluído')
      clearServerForm()
      loadServers()
    } catch {
      toast.error('Erro ao excluir servidor')
    }
  }

  function getServerName(serverId) {
    return servers.find((s) => s.id === serverId)?.name || 'Servidor não encontrado'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-orange-50/10 to-red-50/10">
      <header className="border-b border-gray-200 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <img
              className="h-10 w-auto"
              src="/tropical-play.svg"
              alt="Tropical Play"
            />
            <span className="text-lg font-semibold text-gray-900">
              Tropical Play - Admin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user?.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-secondary py-2"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl py-6 px-4 sm:px-6 lg:px-8">
        <div className="glass-card">
          <nav className="flex border-b border-gray-200" aria-label="Tabs">
            <button
              type="button"
              className={`nav-tab ${tab === tabDevices ? 'nav-tab-active' : 'nav-tab-inactive'}`}
              onClick={() => setTab(tabDevices)}
            >
              Dispositivos e Listas
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === tabLists ? 'nav-tab-active' : 'nav-tab-inactive'}`}
              onClick={() => setTab(tabLists)}
            >
              Configurações
            </button>
          </nav>

          <div className="mobile-container">
            {tab === tabDevices && (
              <div className="space-y-8">
                {/* Form add/edit device */}
                <div className="glass-card mobile-card bg-gradient-to-r from-orange-50 to-red-50">
                  <h2 className="mb-6 text-xl font-semibold text-gray-900">
                    {editingDevice ? 'Editar Dispositivo' : 'Adicionar Novo Dispositivo'}
                  </h2>
                  <form onSubmit={saveDevice} className="space-y-6">
                    {!editingDevice && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Número do Usuário
                        </label>
                        <input
                          type="text"
                          value={deviceForm.userNumber}
                          onChange={(e) =>
                            setDeviceForm((f) => ({ ...f, userNumber: e.target.value }))
                          }
                          className="input-field"
                          placeholder="123456"
                        />
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Status do Pagamento
                      </label>
                      <select
                        value={deviceForm.paymentStatus ? 'true' : 'false'}
                        onChange={(e) =>
                          setDeviceForm((f) => ({
                            ...f,
                            paymentStatus: e.target.value === 'true',
                          }))
                        }
                        className="input-field"
                      >
                        <option value="false">Pendente</option>
                        <option value="true">Pago</option>
                      </select>
                    </div>
                    {editingDevice && (
                      <>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Atualização do Vencimento
                          </label>
                          <select
                            value={deviceForm.expiryUpdateMode}
                            onChange={(e) =>
                              setDeviceForm((f) => ({
                                ...f,
                                expiryUpdateMode: e.target.value,
                              }))
                            }
                            className="input-field"
                          >
                            <option value="keep">Não alterar vencimento</option>
                            <option value="months">Adicionar meses</option>
                            <option value="manual">Editar data manualmente</option>
                          </select>
                        </div>

                        {deviceForm.expiryUpdateMode === 'months' && (
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Quantidade de meses para adicionar
                            </label>
                            <select
                              value={deviceForm.expiryMonths}
                              onChange={(e) =>
                                setDeviceForm((f) => ({
                                  ...f,
                                  expiryMonths: e.target.value,
                                }))
                              }
                              className="input-field"
                            >
                              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((month) => (
                                <option key={month} value={month}>
                                  {month} {month === '1' ? 'mês' : 'meses'}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-gray-500">
                              Para mais de 12 meses, use a opção "Editar data manualmente".
                            </p>
                          </div>
                        )}

                        {deviceForm.expiryUpdateMode === 'manual' && (
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Data de Vencimento
                            </label>
                            <input
                              type="date"
                              value={deviceForm.expiresAt || ''}
                              onChange={(e) =>
                                setDeviceForm((f) => ({ ...f, expiresAt: e.target.value }))
                              }
                              className="input-field"
                            />
                          </div>
                        )}
                      </>
                    )}
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium text-gray-900">Listas M3U</h3>
                      <p className="text-sm text-gray-500">
                        Adicione listas ao dispositivo. Servidor, usuário e senha são
                        preenchidos por lista.
                      </p>
                      {(deviceForm.lists || []).map((list, idx) => (
                        <div
                          key={idx}
                          className="grid gap-3 rounded-lg border border-gray-200 bg-white/50 p-3 sm:grid-cols-2 md:grid-cols-4"
                        >
                          <div>
                            <label className="text-xs text-gray-500">Servidor</label>
                            <select
                              value={list.serverId || ''}
                              onChange={(e) =>
                                setDeviceForm((f) => {
                                  const lists = [...(f.lists || [])]
                                  lists[idx] = {
                                    ...lists[idx],
                                    serverId: e.target.value,
                                    name:
                                      servers.find((s) => s.id === e.target.value)
                                        ?.name || '',
                                  }
                                  return { ...f, lists }
                                })
                              }
                              className="input-field"
                            >
                              <option value="">Selecione</option>
                              {servers.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Usuário</label>
                            <input
                              type="text"
                              value={list.username || ''}
                              onChange={(e) =>
                                setDeviceForm((f) => {
                                  const lists = [...(f.lists || [])]
                                  lists[idx] = { ...lists[idx], username: e.target.value }
                                  return { ...f, lists }
                                })
                              }
                              className="input-field"
                              placeholder="Username"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Senha</label>
                            <input
                              type="text"
                              value={list.password || ''}
                              onChange={(e) =>
                                setDeviceForm((f) => {
                                  const lists = [...(f.lists || [])]
                                  lists[idx] = { ...lists[idx], password: e.target.value }
                                  return { ...f, lists }
                                })
                              }
                              className="input-field"
                              placeholder="Senha"
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() =>
                                setDeviceForm((f) => ({
                                  ...f,
                                  lists: (f.lists || []).filter((_, i) => i !== idx),
                                }))
                              }
                              className="text-sm text-red-600 hover:text-red-800"
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setDeviceForm((f) => ({
                            ...f,
                            lists: [...(f.lists || []), { serverId: '', username: '', password: '' }],
                          }))
                        }
                        className="text-sm text-orange-600 hover:text-orange-800"
                      >
                        + Adicionar lista
                      </button>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:space-x-3">
                      {editingDevice && (
                        <button
                          type="button"
                          onClick={clearDeviceForm}
                          className="btn-secondary w-full sm:w-auto"
                        >
                          Cancelar
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={savingDevice}
                        className="btn-primary w-full sm:w-auto"
                      >
                        {savingDevice ? 'Processando...' : editingDevice ? 'Atualizar' : 'Adicionar'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Device list */}
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:space-x-4">
                    <input
                      type="text"
                      placeholder="Pesquisar por número de usuário ou nome da lista..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="input-field flex-1"
                    />
                    <span className="text-sm text-gray-500">
                      {filteredDevices.length}{' '}
                      {filteredDevices.length === 1 ? 'dispositivo' : 'dispositivos'} encontrado
                      {filteredDevices.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="table-container">
                    <div className="overflow-x-auto scrollbar-hide">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="table-header">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                              Número do Usuário
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                              Listas
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                              Criado em
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                              Vence em
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                              Status
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                              Ações
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white/50 backdrop-blur-sm">
                          {loading ? (
                            <tr>
                              <td colSpan={6} className="table-cell text-center">
                                Carregando...
                              </td>
                            </tr>
                          ) : filteredDevices.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="table-cell text-center">
                                Nenhum dispositivo encontrado.
                              </td>
                            </tr>
                          ) : (
                            filteredDevices.map((device) => (
                              <tr key={device.id} className="table-row">
                                <td className="table-cell font-medium text-gray-900">
                                  {device.userNumber}
                                </td>
                                <td className="table-cell">
                                  <div className="space-y-1">
                                    {(device.lists || []).map((list, i) => (
                                      <div
                                        key={i}
                                        className="flex flex-col sm:flex-row sm:items-center sm:space-x-2"
                                      >
                                        <span className="text-gray-900">
                                          {getServerName(list.serverId)}
                                        </span>
                                        <a
                                          href={list.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm text-orange-600 hover:text-orange-700"
                                        >
                                          Ver Lista
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="table-cell">{formatDate(device.createdAt)}</td>
                                <td className="table-cell">{formatDate(device.expiresAt)}</td>
                                <td className="table-cell">
                                  <select
                                    value={String(device.paymentStatus)}
                                    onChange={(e) =>
                                      setPaymentStatus(device.id, e.target.value === 'true')
                                    }
                                    className={`status-badge ${
                                      device.paymentStatus ? 'status-badge-paid' : 'status-badge-pending'
                                    }`}
                                  >
                                    <option value="false">Pendente</option>
                                    <option value="true">Pago</option>
                                  </select>
                                </td>
                                <td className="table-cell space-x-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => openEditDevice(device)}
                                    className="text-orange-600 transition-colors duration-200 hover:text-orange-900"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteDevice(device.id)}
                                    className="text-red-600 transition-colors duration-200 hover:text-red-900"
                                  >
                                    Excluir
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === tabLists && (
              <div className="space-y-8">
                {/* Form add/edit server */}
                <div className="glass-card mobile-card bg-gradient-to-r from-orange-50 to-red-50">
                  <h2 className="mb-6 text-xl font-semibold text-gray-900">
                    {editingServer ? 'Editar Servidor' : 'Adicionar Novo Servidor'}
                  </h2>
                  <form onSubmit={saveServer} className="space-y-6">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Nome do Servidor
                      </label>
                      <input
                        type="text"
                        value={serverForm.name}
                        onChange={(e) =>
                          setServerForm((f) => ({ ...f, name: e.target.value }))
                        }
                        className="input-field"
                        placeholder="Ex: Tropical Play TV 1"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        DNS do Servidor
                      </label>
                      <input
                        type="text"
                        value={serverForm.dns}
                        onChange={(e) =>
                          setServerForm((f) => ({ ...f, dns: e.target.value }))
                        }
                        className="input-field"
                        placeholder="http://server.tropicalplaytv.com:80"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Complemento do DNS
                      </label>
                      <input
                        type="text"
                        value={serverForm.complement}
                        onChange={(e) =>
                          setServerForm((f) => ({ ...f, complement: e.target.value }))
                        }
                        className="input-field"
                        placeholder="&type=m3u_plus&output=mpegts"
                      />
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:space-x-3">
                      {editingServer && (
                        <button
                          type="button"
                          onClick={clearServerForm}
                          className="btn-secondary w-full sm:w-auto"
                        >
                          Cancelar
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={savingServer}
                        className="btn-primary w-full sm:w-auto"
                      >
                        {savingServer
                          ? 'Salvando e atualizando dispositivos...'
                          : editingServer
                            ? 'Salvar e atualizar todos'
                            : 'Adicionar'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Server list */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900">Servidores cadastrados</h3>
                  <div className="table-container">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="table-header">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                            Nome do servidor
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                            DNS
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                            Complemento DNS
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 md:px-6">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white/50 backdrop-blur-sm">
                        {servers.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="table-cell text-center">
                              Nenhum servidor cadastrado.
                            </td>
                          </tr>
                        ) : (
                          servers.map((server) => (
                            <tr key={server.id} className="table-row">
                              <td className="table-cell font-medium text-gray-900">
                                {server.name}
                              </td>
                              <td className="table-cell text-orange-600">{server.dns}</td>
                              <td className="table-cell text-gray-600">
                                {server.complement || '-'}
                              </td>
                              <td className="table-cell space-x-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => openEditServer(server)}
                                  className="text-orange-600 transition-colors duration-200 hover:text-orange-900"
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteServer(server)}
                                  className="text-red-600 transition-colors duration-200 hover:text-red-900"
                                >
                                  Excluir
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
