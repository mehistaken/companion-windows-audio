using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;

namespace AudioSidecar;

/// <summary>
/// Wraps the undocumented Windows IPolicyConfig COM interface, which is the only
/// way to programmatically change the default audio endpoint on Vista+.
/// The CLSID/IID are stable across Windows versions since Vista.
/// </summary>
internal static class PolicyConfig
{
    private static readonly Guid ClsidPolicyConfig = new("870af99c-171d-4f9e-af0d-e63df40c2bc9");

    // v_Win10 variant used on Windows 10+
    [ComImport]
    [Guid("f8679f50-850a-41cf-9c72-430f290290c8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        void GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr ppFormat);
        void GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, [MarshalAs(UnmanagedType.Bool)] bool bDefault, IntPtr ppFormat);
        void ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName);
        void SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr pEndpointFormat, IntPtr pMixFormat);
        void GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceName, [MarshalAs(UnmanagedType.Bool)] bool bDefault, IntPtr pmftDefaultPeriod, IntPtr pmftMinimumPeriod);
        void SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr pmftPeriod);
        void GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr pMode);
        void SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr mode);
        void GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceName, [MarshalAs(UnmanagedType.Bool)] bool bFxStore, IntPtr key, IntPtr pv);
        void SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceName, [MarshalAs(UnmanagedType.Bool)] bool bFxStore, IntPtr key, IntPtr pv);
        [PreserveSig]
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, Role role);
        void SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceName, [MarshalAs(UnmanagedType.Bool)] bool bVisible);
    }

    public static void SetDefaultEndpoint(string deviceId, Role role)
    {
        var comType = Type.GetTypeFromCLSID(ClsidPolicyConfig)
            ?? throw new InvalidOperationException("CPolicyConfigClient COM class not available on this system");

        var instance = (IPolicyConfig)(Activator.CreateInstance(comType)
            ?? throw new InvalidOperationException("Failed to instantiate CPolicyConfigClient"));
        try
        {
            var hr = instance.SetDefaultEndpoint(deviceId, role);
            if (hr != 0)
                Console.Error.WriteLine($"[policy] SetDefaultEndpoint returned HRESULT 0x{hr:X8}");
        }
        finally
        {
            Marshal.ReleaseComObject(instance);
        }
    }
}
